import { parseTsv } from "./parse.js";
import type { Engine } from "./types.js";

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

const lit = (value: string) =>
  `CONVERT(FROM_BASE64('${b64(value)}') USING utf8mb4)`;
const q = (name: string) => `\`${name.replace(/`/g, "``")}\``;

// Plain strings, not template literals: the bash here has ${...} in it.
export const mysql: Engine = {
  id: "mysql",
  client: "mysql",
  passwordEnv: "MYSQL_PWD",
  run: (readOnly) => [
    "args=(--batch --default-character-set=utf8mb4 --connect-timeout=10)",
    '[ -n "$DB_ADDR" ] && args+=(-h "$DB_ADDR" --protocol=TCP)',
    '[ -n "$DB_PORT" ] && args+=(-P "$DB_PORT")',
    '[ -n "$DB_USER" ] && args+=(-u "$DB_USER")',
    '[ -n "$DB_NAME" ] && args+=(-D "$DB_NAME")',
    ...(readOnly
      ? ["args+=(--init-command='SET SESSION TRANSACTION READ ONLY')"]
      : []),
    'mysql "${args[@]}" -e "$SQL" </dev/null',
  ],
  parse: parseTsv,
  q,
  lit,
  // MySQL converts the text to the column type on its own.
  value: (text) => lit(text),
  ref: (schema, table) => `${q(schema)}.${q(table)}`,
  databasesSql:
    "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
  tablesSql: (db) =>
    "SELECT table_schema, table_name, IF(table_type = 'VIEW', 'view', 'table'), table_rows " +
    `FROM information_schema.tables WHERE table_schema = ${lit(db)} ORDER BY table_name`,
  columnsSql: (schema, table) =>
    "SELECT column_name, column_type, IF(is_nullable = 'YES', 1, 0), " +
    "IF(column_key = 'PRI', 1, 0), column_default, extra " +
    `FROM information_schema.columns WHERE table_schema = ${lit(schema)} ` +
    `AND table_name = ${lit(table)} ORDER BY ordinal_position`,
  indexesSql: (schema, table) =>
    "SELECT index_name, CONCAT(IF(non_unique = 0, 'UNIQUE ', ''), index_type, ' (', " +
    "GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ', '), ')') " +
    `FROM information_schema.statistics WHERE table_schema = ${lit(schema)} ` +
    `AND table_name = ${lit(table)} GROUP BY index_name, non_unique, index_type ORDER BY index_name`,
  counted: (statement) => `${statement}; SELECT ROW_COUNT() AS n`,
  insertEmpty: (ref) => `INSERT INTO ${ref} () VALUES ()`,
  versionSql: "SELECT VERSION()",
  systemDatabases: ["information_schema", "mysql", "performance_schema", "sys"],
};
