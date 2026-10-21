import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginHostAccess } from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";

export const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
export const manifest = manifestJson as unknown as PluginManifest;

export interface Call {
  hostId: number;
  command: string;
  stdin: string;
}

export interface FakeSsh {
  calls: Call[];
  /** Replies by a piece of the script text. The first match wins. */
  replies: Array<{
    match: string;
    stdout?: string;
    stderr?: string;
    code?: number;
  }>;
  /** Run the scripts in a local bash instead of replying from the list. */
  local: boolean;
}

export interface TestServer {
  mock: MockPluginContext;
  ssh: FakeSsh;
  request: (
    method: string,
    path: string,
    body?: unknown,
    // Route bodies vary per test; asserting on them is the point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<{ status: number; body: any }>;
  /** Changes the user's access to the host from now on. */
  setLevel: (next: PluginHostAccess["permissionLevel"] | "none") => void;
  close: () => Promise<void>;
}

export const hasBash = spawnSync("bash", ["--version"]).status === 0;
export const hasSqlite = spawnSync("sqlite3", ["--version"]).status === 0;

/** The plugin on a real express app, with ctx.ssh.exec played by a fake. */
export async function startServer(
  options: {
    permissions?: string[];
    level?: PluginHostAccess["permissionLevel"] | "none";
    local?: boolean;
  } = {},
): Promise<TestServer> {
  let router: Router | null = null;
  const db = await createTestDb(pluginDir);
  db.sqlite.exec(
    "INSERT INTO users (id, username) VALUES ('user-1', 'user-1')",
  );
  db.sqlite.exec("INSERT INTO ssh_data DEFAULT VALUES");
  db.sqlite.exec("INSERT INTO ssh_data DEFAULT VALUES");
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    actor: "user-1",
    router: () => (router = express.Router()),
    permissions: options.permissions ?? ["databases.use"],
  });

  const rank = { connect: 1, view: 2, edit: 3, manage: 4 } as const;
  let level = options.level ?? "manage";
  Object.assign(mock.ctx.hosts, {
    checkAccess: async (
      _id: number,
      need: keyof typeof rank = "connect",
    ): Promise<PluginHostAccess> => ({
      hasAccess: level !== "none" && rank[level] >= rank[need],
      isOwner: true,
      isShared: false,
      permissionLevel: level === "none" ? undefined : level,
    }),
  });

  const ssh: FakeSsh = {
    calls: [],
    replies: [],
    local: options.local ?? false,
  };
  Object.assign(mock.ctx.ssh, {
    exec: async (
      hostId: number,
      command: string,
      opts?: { stdin?: string },
    ) => {
      const stdin = opts?.stdin ?? "";
      ssh.calls.push({ hostId, command, stdin });
      if (ssh.local) {
        const run = spawnSync("bash", ["-s"], {
          input: stdin,
          encoding: "utf8",
        });
        return {
          stdout: run.stdout,
          stderr: run.stderr,
          code: run.status,
          truncated: false,
          timedOut: false,
        };
      }
      const haystack = [stdin, ...statements(stdin)].join("\n");
      const reply = ssh.replies.find((r) => haystack.includes(r.match));
      return {
        stdout: reply?.stdout ?? "",
        stderr: reply?.stderr ?? "",
        code: reply?.code ?? 0,
        truncated: false,
        timedOut: false,
      };
    },
  });

  const { activate } = await import("../../src/backend/index.js");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => router!(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    mock,
    ssh,
    setLevel(next) {
      level = next;
    },
    async request(method, path, body) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

/** The SQL statements inside a generated script, decoded. */
export function statements(stdin: string): string[] {
  const out: string[] = [];
  for (const m of stdin.matchAll(/SQL="\$\(printf %s '([A-Za-z0-9+/=]*)'/g)) {
    out.push(Buffer.from(m[1], "base64").toString("utf8"));
  }
  return out;
}
