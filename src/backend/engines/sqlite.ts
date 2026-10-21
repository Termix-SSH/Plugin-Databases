import { parseCsv } from "./parse.js";
import type { Engine } from "./types.js";

const lit = (value: string) =>
  `CAST(x'${Buffer.from(value, "utf8").toString("hex")}' AS TEXT)`;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Plain strings, not template literals: the bash here has ${...} in it.
export const sqlite: Engine = {
  id: "sqlite",
  client: "sqlite3",
  passwordEnv: "",
  run: (readOnly) => [
    '[ -f "$DB_FILE" ] || { echo "DB_ERR:The SQLite file was not found"; exit 2; }',
    'ERRF="$(mktemp)"',
    // The SQL goes in on stdin so it can start with a dash. Older sqlite3
    // builds exit 0 after an error, so any stderr text counts as a failure.
    `{ ${readOnly ? "echo 'PRAGMA query_only = ON;'; " : ""}printf '%s\\n' "$SQL"; } | sqlite3 -bail -csv -header -nullvalue "$NM" -cmd ".timeout 5000" "$DB_FILE" 2>"$ERRF"`,
    "rc=$?",
    'if [ -s "$ERRF" ]; then cat "$ERRF" >&2; rm -f "$ERRF"; return 1; fi',
    'rm -f "$ERRF"',
    "return $rc",
  ],
  parse: parseCsv,
  q,
  lit,
  // SQLite converts the text with the column affinity.
  value: (text) => lit(text),
  ref: (_schema, table) => q(table),
  databasesSql: "SELECT 'main'",
  tablesSql: () =>
    "SELECT 'main', name, CASE type WHEN 'view' THEN 'view' ELSE 'table' END, NULL " +
    "FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
  columnsSql: (_schema, table) =>
    'SELECT name, type, CASE WHEN "notnull" = 1 THEN 0 ELSE 1 END, ' +
    "CASE WHEN pk > 0 THEN 1 ELSE 0 END, dflt_value, '' " +
    `FROM pragma_table_info(${lit(table)})`,
  indexesSql: (_schema, table) =>
    "SELECT name, COALESCE(sql, '(automatic index)') FROM sqlite_master " +
    `WHERE type = 'index' AND tbl_name = ${lit(table)} ORDER BY name`,
  counted: (statement) => `${statement}; SELECT changes() AS n`,
  insertEmpty: (ref) => `INSERT INTO ${ref} DEFAULT VALUES`,
  versionSql: "SELECT sqlite_version()",
  systemDatabases: [],
};
