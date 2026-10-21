import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEngine, type Conn } from "../../src/backend/engines/index";
import { buildScript, TOOLS_SCRIPT } from "../../src/backend/script";
import { hasBash } from "./helpers";

const login = (overrides: Partial<Conn>): Conn => ({
  engine: "mysql",
  address: "db.local",
  port: 3307,
  username: "app",
  password: 'p\'w "x" $y',
  database: "shop",
  runAs: "",
  ...overrides,
});

function posix(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
}

let bin = "";

// Stand-ins that print what they were given, so the arguments and the
// password variable can be checked without a real server.
beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), "fake-bin-"));
  for (const name of ["mysql", "psql"]) {
    const file = join(bin, name);
    writeFileSync(
      file,
      [
        "#!/bin/bash",
        'for a in "$@"; do echo "ARG:$a"; done',
        'echo "MYSQL_PWD:$MYSQL_PWD"',
        'echo "PGPASSWORD:$PGPASSWORD"',
        'echo "PGOPTIONS:$PGOPTIONS"',
        "",
      ].join("\n"),
    );
    chmodSync(file, 0o755);
  }
});

afterAll(() => {
  if (bin) rmSync(bin, { recursive: true, force: true });
});

function run(script: string) {
  const full = `export PATH="${posix(bin)}:$PATH"\n${script}`;
  return spawnSync("bash", ["-s"], { input: full, encoding: "utf8" });
}

describe.skipIf(!hasBash)("generated scripts", () => {
  it("are valid bash for every engine", () => {
    for (const engine of ["mysql", "postgres", "sqlite"] as const) {
      for (const readOnly of [true, false]) {
        const script = buildScript(
          getEngine(engine),
          login({ engine, database: engine === "sqlite" ? "/a.db" : "shop" }),
          "shop",
          ["SELECT 1", "SELECT 'it''s'"],
          readOnly,
        );
        const check = spawnSync("bash", ["-n"], {
          input: script,
          encoding: "utf8",
        });
        expect(check.stderr).toBe("");
        expect(check.status).toBe(0);
      }
    }
    expect(spawnSync("bash", ["-n"], { input: TOOLS_SCRIPT }).status).toBe(0);
  });

  it("runs mysql with the login, the password in the environment", () => {
    const script = buildScript(
      getEngine("mysql"),
      login({}),
      "shop",
      ["SELECT 'a'"],
      true,
    );
    expect(script).not.toContain("p'w");
    const out = run(script).stdout;
    expect(out).toContain("ARG:-h\nARG:db.local\nARG:--protocol=TCP");
    expect(out).toContain("ARG:-P\nARG:3307");
    expect(out).toContain("ARG:-u\nARG:app");
    expect(out).toContain("ARG:-D\nARG:shop");
    expect(out).toContain(
      "ARG:--init-command=SET SESSION TRANSACTION READ ONLY",
    );
    expect(out).toContain("ARG:-e\nARG:SELECT 'a'");
    expect(out).toContain(`MYSQL_PWD:p'w "x" $y`);
  });

  it("leaves out host and port for a socket login", () => {
    const script = buildScript(
      getEngine("mysql"),
      login({
        address: "",
        port: null,
        username: "",
        password: "",
        database: "",
      }),
      "",
      ["SELECT 1"],
      false,
    );
    const out = run(script).stdout;
    expect(out).not.toContain("ARG:-h");
    expect(out).not.toContain("ARG:-u");
    expect(out).not.toContain("ARG:-D");
    expect(out).not.toContain("READ ONLY");
    expect(out).toContain("MYSQL_PWD:\n");
  });

  it("runs psql with csv output and a read only session", () => {
    const script = buildScript(
      getEngine("postgres"),
      login({ engine: "postgres", port: 5433 }),
      "orders",
      ["SELECT 1"],
      true,
    );
    const out = run(script).stdout;
    expect(out).toContain("ARG:--csv");
    expect(out).toContain("ARG:ON_ERROR_STOP=1");
    expect(out).toContain("ARG:-p\nARG:5433");
    expect(out).toContain("ARG:-U\nARG:app");
    expect(out).toContain("ARG:-d\nARG:orders");
    expect(out).toContain("ARG:-c\nARG:SELECT 1");
    expect(out).toContain(`PGPASSWORD:p'w "x" $y`);
    expect(out).toContain("PGOPTIONS:-c default_transaction_read_only=on");
  });

  it("falls back to the postgres database", () => {
    const script = buildScript(
      getEngine("postgres"),
      login({ engine: "postgres", database: "" }),
      "",
      ["SELECT 1"],
      false,
    );
    const out = run(script).stdout;
    expect(out).toContain("ARG:-d\nARG:postgres");
    expect(out).toContain("PGOPTIONS:\n");
  });

  it("prints a marker between statements", () => {
    const script = buildScript(
      getEngine("mysql"),
      login({}),
      "shop",
      ["SELECT 1", "SELECT 2"],
      false,
    );
    const out = run(script).stdout;
    expect(out.match(/@@DBX-7f3a@@/g)).toHaveLength(1);
    expect(out.indexOf("ARG:SELECT 1")).toBeLessThan(
      out.indexOf("ARG:SELECT 2"),
    );
  });

  it("stops with a clear message when the client is missing", () => {
    const script = buildScript(
      getEngine("postgres"),
      login({ engine: "postgres" }),
      "",
      ["SELECT 1"],
      false,
    );
    const result = spawnSync("bash", ["-s"], {
      input: `PATH=/nonexistent\n${script}`,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("DB_ERR:psql is not installed");
  });
});
