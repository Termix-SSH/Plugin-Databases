import type { Conn, Engine } from "./engines/index.js";
import { SECTION_MARK } from "./engines/parse.js";

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

/** A shell variable set from text that went through base64, so no quoting. */
function setVar(name: string, value: string): string {
  return `${name}="$(printf %s '${b64(value)}' | base64 -d)"`;
}

/**
 * One script for the host: it checks the client exists, sets the login from
 * base64 values, then runs each statement and prints a marker between the
 * results. The password goes in an env var, never on the command line.
 */
export function buildScript(
  engine: Engine,
  conn: Conn,
  db: string,
  statements: string[],
  readOnly: boolean,
): string {
  const lines = [
    `command -v ${engine.client} >/dev/null 2>&1 || { echo "DB_ERR:${engine.client} is not installed on this host"; exit 127; }`,
    "NM=$'\\001N\\001'",
    setVar("DB_ADDR", conn.address),
    setVar("DB_PORT", conn.port ? String(conn.port) : ""),
    setVar("DB_USER", conn.username),
    setVar("DB_NAME", db || (engine.id === "sqlite" ? "" : conn.database)),
    setVar("DB_FILE", engine.id === "sqlite" ? conn.database : ""),
  ];
  if (conn.password && engine.passwordEnv) {
    lines.push(
      `export ${engine.passwordEnv}="$(printf %s '${b64(conn.password)}' | base64 -d)"`,
    );
  }
  lines.push("dbx() {", ...engine.run(readOnly), "}");
  statements.forEach((sql, index) => {
    if (index > 0) lines.push(`echo '${SECTION_MARK}'`);
    lines.push(
      `SQL="$(printf %s '${b64(sql)}' | base64 -d)"`,
      "dbx || exit $?",
    );
  });
  return `${lines.join("\n")}\n`;
}

/** Looks for the three clients and prints name=version lines. */
export const TOOLS_SCRIPT = [
  "for t in mysql psql sqlite3; do",
  '  if command -v "$t" >/dev/null 2>&1; then',
  '    echo "$t=$("$t" --version 2>&1 | head -n 1)"',
  "  else",
  '    echo "$t="',
  "  fi",
  "done",
  "",
].join("\n");
