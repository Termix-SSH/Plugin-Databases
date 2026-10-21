import { parseCsv } from "./parse.js";
import type { Engine } from "./types.js";

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

const lit = (value: string) =>
  `convert_from(decode('${b64(value)}', 'base64'), 'UTF8')`;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Plain strings, not template literals: the bash here has ${...} in it.
export const postgres: Engine = {
  id: "postgres",
  client: "psql",
  passwordEnv: "PGPASSWORD",
  run: (readOnly) => [
    'args=(-X -q --csv -v ON_ERROR_STOP=1 -P "null=$NM")',
    '[ -n "$DB_ADDR" ] && args+=(-h "$DB_ADDR")',
    '[ -n "$DB_PORT" ] && args+=(-p "$DB_PORT")',
    '[ -n "$DB_USER" ] && args+=(-U "$DB_USER")',
    'args+=(-d "${DB_NAME:-postgres}")',
    "export PGCONNECT_TIMEOUT=10",
    ...(readOnly
      ? ['export PGOPTIONS="-c default_transaction_read_only=on"']
      : []),
    'psql "${args[@]}" -c "$SQL" </dev/null',
  ],
  parse: parseCsv,
  q,
  lit,
  value: (text, type) => `CAST(${lit(text)} AS ${type})`,
  ref: (schema, table) => `${q(schema)}.${q(table)}`,
  databasesSql:
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname",
  tablesSql: () =>
    "SELECT n.nspname, c.relname, " +
    "CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END, " +
    "CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') " +
    "AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg\\_toast%' ORDER BY n.nspname, c.relname",
  columnsSql: (schema, table) =>
    "SELECT a.attname, format_type(a.atttypid, a.atttypmod), " +
    "(NOT a.attnotnull)::int, COALESCE(a.attnum = ANY (i.indkey), false)::int, " +
    "pg_get_expr(d.adbin, d.adrelid), " +
    "CASE WHEN a.attgenerated <> '' THEN 'generated' WHEN a.attidentity <> '' THEN 'identity' ELSE '' END " +
    "FROM pg_attribute a JOIN pg_class cl ON cl.oid = a.attrelid " +
    "JOIN pg_namespace n ON n.oid = cl.relnamespace " +
    "LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum " +
    "LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary " +
    `WHERE n.nspname = ${lit(schema)} AND cl.relname = ${lit(table)} ` +
    "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
  indexesSql: (schema, table) =>
    "SELECT indexname, indexdef FROM pg_indexes " +
    `WHERE schemaname = ${lit(schema)} AND tablename = ${lit(table)} ORDER BY indexname`,
  counted: (statement) =>
    `WITH r AS (${statement} RETURNING 1) SELECT count(*) AS n FROM r`,
  insertEmpty: (ref) => `INSERT INTO ${ref} DEFAULT VALUES`,
  versionSql: "SELECT version()",
  systemDatabases: [],
};
