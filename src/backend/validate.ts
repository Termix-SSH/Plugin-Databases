import { DatabasesError } from "./errors.js";
import {
  ENGINES,
  type ConnectionInput,
  type EngineId,
  type RowValues,
} from "../shared/types.js";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const ADDRESS = /^[A-Za-z0-9_.:\-[\]]{1,253}$/;
const LINUX_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;

export const MAX_ROWS = 500;
export const CONSOLE_ROWS = 1000;

function text(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new DatabasesError(`${label} is not valid`);
  }
  if (value.length > max) throw new DatabasesError(`${label} is too long`);
  return value;
}

/** A name that is quoted before use, so only control characters are refused. */
export function name(value: unknown, label: string, required = true): string {
  const out = text(value, label, 256);
  if (required && !out) throw new DatabasesError(`${label} is required`);
  if (CONTROL.test(out)) throw new DatabasesError(`${label} is not valid`);
  return out;
}

export function engineId(value: unknown): EngineId {
  if (
    typeof value === "string" &&
    (ENGINES as readonly string[]).includes(value)
  ) {
    return value as EngineId;
  }
  throw new DatabasesError("The database type is not valid");
}

export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new DatabasesError(`${label} is not valid`);
  }
  return n;
}

export function connectionInput(body: unknown): ConnectionInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const engine = engineId(b.engine);
  const label = text(b.name, "The name", 80).trim();
  if (!label) throw new DatabasesError("The name is required");
  if (CONTROL.test(label)) throw new DatabasesError("The name is not valid");

  const address = text(b.address, "The address", 253).trim();
  if (address && !ADDRESS.test(address)) {
    throw new DatabasesError("The address is not valid");
  }
  let port: number | null = null;
  if (b.port !== undefined && b.port !== null && b.port !== "") {
    port = integer(b.port, "The port", 1, 65535, 0);
  }

  const username = text(b.username, "The user", 128).trim();
  if (CONTROL.test(username)) throw new DatabasesError("The user is not valid");

  const password = text(b.password, "The password", 256);
  if (password.includes("\u0000")) {
    throw new DatabasesError("The password is not valid");
  }

  const database = text(b.database, "The database", 1024).trim();
  if (CONTROL.test(database)) {
    throw new DatabasesError("The database is not valid");
  }
  if (engine === "sqlite" && !database.startsWith("/")) {
    throw new DatabasesError("Enter the full path of the SQLite file");
  }

  const runAs = text(b.runAs, "Run as", 32).trim();
  if (runAs && !LINUX_NAME.test(runAs)) {
    throw new DatabasesError("Run as is not a valid Linux user");
  }

  return {
    name: label,
    engine,
    address: engine === "sqlite" ? "" : address,
    port: engine === "sqlite" ? null : port,
    username: engine === "sqlite" ? "" : username,
    password: engine === "sqlite" ? "" : password,
    clearPassword: b.clearPassword === true,
    database,
    runAs,
    readOnly: b.readOnly === true,
  };
}

/** Values of a row. Every value is text or null. */
export function rowValues(value: unknown, label: string): RowValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DatabasesError(`${label} is not valid`);
  }
  const out: RowValues = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    name(key, "A column name");
    if (v !== null && typeof v !== "string") {
      throw new DatabasesError(`The value of ${key} is not valid`);
    }
    if (
      typeof v === "string" &&
      (v.length > 1_000_000 || v.includes("\u0000"))
    ) {
      throw new DatabasesError(`The value of ${key} is not valid`);
    }
    out[key] = v as string | null;
  }
  return out;
}

/** A WHERE clause from the grid filter. One statement only. */
export function filter(value: unknown): string {
  const out = text(value, "The filter", 500).trim();
  if (!out) return "";
  if (out.includes(";") || out.includes("\u0000")) {
    throw new DatabasesError("The filter must be a single condition");
  }
  if (/\\[!.]/.test(out) || /^\s*[\\.]/m.test(out)) {
    throw new DatabasesError("The filter is not valid");
  }
  return out;
}

/**
 * Stops client commands (psql backslash lines, sqlite dot lines, mysql system
 * and source) from reaching the command line tools. This is a guard, not a
 * security boundary: the database user's own rights still apply.
 */
export function plainSql(engine: EngineId, value: unknown): string {
  const sql = text(value, "The SQL", 200_000).trim();
  if (!sql) throw new DatabasesError("Enter some SQL to run");
  if (sql.includes("\u0000")) throw new DatabasesError("The SQL is not valid");
  const lines = sql.split("\n").map((line) => line.trim());
  const bad =
    engine === "postgres"
      ? lines.some((line) => line.startsWith("\\"))
      : engine === "sqlite"
        ? lines.some((line) => line.startsWith("."))
        : lines.some(
            (line) =>
              line.startsWith("\\") ||
              line.startsWith("!") ||
              /^(system|source)\s/i.test(line),
          ) || /\\[!.]/.test(sql);
  if (bad) {
    throw new DatabasesError("Client commands are not allowed in SQL");
  }
  return sql;
}
