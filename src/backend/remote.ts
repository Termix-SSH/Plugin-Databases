import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { DatabasesError } from "./errors.js";

const PATH =
  'export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin:/opt/homebrew/bin"; ';
const PLAIN_SHELL = PATH + "exec bash -s";

const SUDO_HINT = /password is required|a terminal is required|no tty present/i;
const MAX_OUTPUT = 4 * 1024 * 1024;

/** Trims output and keeps it short enough to show. */
export function scrub(text: string, max = 600): string {
  return text.trim().slice(0, max);
}

/** Scripts print DB_ERR: lines before a non zero exit to explain a failure. */
function scriptError(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("DB_ERR:"))
    .map((line) => line.slice("DB_ERR:".length))
    .join("\n")
    .trim();
}

/** Runs as the login user, or as another Linux user through sudo -n -u. */
function shellFor(runAs: string): string {
  if (!runAs) return PLAIN_SHELL;
  return (
    PATH +
    `if [ "$(id -un)" = "${runAs}" ]; then exec bash -s; else exec sudo -n -u ${runAs} env PATH="$PATH" bash -s; fi`
  );
}

export interface Remote {
  run: (
    hostId: number,
    runAs: string,
    script: string,
    timeoutMs?: number,
  ) => Promise<string>;
}

export function createRemote(ctx: PluginContext): Remote {
  return {
    async run(hostId, runAs, script, timeoutMs = 30_000) {
      const result = await ctx.ssh.exec(hostId, shellFor(runAs), {
        stdin: script,
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT,
        purpose: "databases",
      });
      if (result.timedOut) {
        throw new DatabasesError("The database took too long to answer", 504);
      }
      if (result.truncated) {
        throw new DatabasesError(
          "The result is too large. Add a filter or a LIMIT.",
          413,
        );
      }
      if (result.code !== 0) {
        if (SUDO_HINT.test(result.stderr)) {
          throw new DatabasesError(
            `This host needs passwordless sudo to run as ${runAs}`,
            400,
            { code: "sudo" },
          );
        }
        const own = scriptError(result.stdout);
        // The MariaDB client warns on every passworded TCP login.
        const stderr = result.stderr
          .split("\n")
          .filter((line) => !line.startsWith("WARNING:"))
          .join("\n");
        throw new DatabasesError(
          scrub(own || stderr || result.stdout || "Command failed", 1500),
        );
      }
      return result.stdout;
    },
  };
}

/** Reads key=value lines. Only the first = splits a line. */
export function parseKeys(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
