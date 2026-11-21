import type { Grid } from "../../shared/types.js";
import type { Engine } from "./types.js";

/** Marks a statement whose result comes back as FOR JSON text. */
export const JSON_TAG = "/*json*/";
/** Printed before JSON output, so parse knows which shape it got. */
export const JSON_MARK = "@@JSON@@";
const SEP = "\u001f";

// UTF-16 hex, so the value never sits inside quotes.
const lit = (value: string) =>
  value === ""
    ? "CAST(N'' AS NVARCHAR(MAX))"
    : `CAST(0x${Buffer.from(value, "utf16le").toString("hex")} AS NVARCHAR(MAX))`;
const q = (name: string) => `[${name.replace(/]/g, "]]")}]`;

/** Our own statements come back as JSON, which keeps newlines and full values. */
const json = (sql: string) =>
  `${JSON_TAG} ${sql} FOR JSON PATH, INCLUDE_NULL_VALUES`;

type JsonContext = { source?: string };

function jsonCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** FOR JSON output, which sqlcmd splits over lines of about 2000 characters. */
export function parseJson(text: string): Grid {
  const joined = text.replace(/\r?\n/g, "");
  if (!joined.trim()) return { columns: [], rows: [] };
  // Keep big integers exact: take the number's own text.
  const parsed = JSON.parse(
    joined,
    (_key, value: unknown, context?: JsonContext) =>
      typeof value === "number" && context?.source ? context.source : value,
  ) as unknown;
  const list = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : [];
  const columns = list.length > 0 ? Object.keys(list[0]) : [];
  return {
    columns,
    rows: list.map((row) => columns.map((column) => jsonCell(row[column]))),
  };
}

/**
 * sqlcmd's table output: a header, a line of dashes, then padded rows split
 * by the unit separator. A value with a newline spills onto the next line,
 * which is joined back on.
 */
export function parseTable(text: string): Grid {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = lines[0].split(SEP).map((cell) => cell.trim());
  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const cells = line.split(SEP);
    const last = rows[rows.length - 1];
    if (last && last.length < columns.length) {
      last[last.length - 1] += `\n${cells.shift() ?? ""}`;
      last.push(...cells);
    } else if (cells.length < columns.length && last && cells.length === 1) {
      last[last.length - 1] += `\n${cells[0]}`;
    } else {
      rows.push(cells);
    }
  }
  return {
    columns,
    rows: rows.map((row) =>
      row.map((cell) => {
        const value = cell.trim();
        return value === "NULL" ? null : value;
      }),
    ),
  };
}

export function parseMssql(output: string): Grid {
  if (output.startsWith(`${JSON_MARK}\n`)) {
    return parseJson(output.slice(JSON_MARK.length + 1));
  }
  return parseTable(output);
}

// Plain strings, not template literals: the bash here has ${...} in it.
export const mssql: Engine = {
  id: "mssql",
  client: "sqlcmd",
  passwordEnv: "SQLCMDPASSWORD",
  run: (readOnly) => [
    // -C trusts the server certificate, -X turns off !! and :r commands.
    'args=(-C -X -b -l 10 -S "${DB_ADDR:-127.0.0.1}${DB_PORT:+,$DB_PORT}")',
    '[ -n "$DB_USER" ] && args+=(-U "$DB_USER")',
    '[ -n "$DB_NAME" ] && args+=(-d "$DB_NAME")',
    'case "$SQL" in',
    "  '/*json*/'*) mode=json; fmt=(-y 0) ;;",
    "  *) mode=table; fmt=(-y 8000 -s $'\\037') ;;",
    "esac",
    ...(readOnly
      ? [
          'Q="SET NOCOUNT ON; BEGIN TRANSACTION;',
          "$SQL",
          ';IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;"',
        ]
      : ['Q="SET NOCOUNT ON; $SQL"']),
    'out="$(sqlcmd "${args[@]}" "${fmt[@]}" -Q "$Q" </dev/null 2>&1)"',
    "rc=$?",
    'if [ "$rc" -ne 0 ]; then printf \'%s\\n\' "$out" | sed \'s/^/DB_ERR:/\'; return "$rc"; fi',
    '[ "$mode" = json ] && echo \'' + JSON_MARK + "'",
    '[ -n "$out" ] && printf \'%s\\n\' "$out"',
    "return 0",
  ],
  parse: parseMssql,
  q,
  lit,
  // SQL Server converts the text to the column type on its own.
  value: (text) => lit(text),
  ref: (schema, table) => `${q(schema || "dbo")}.${q(table)}`,
  defaultSchema: "dbo",
  databasesSql: json("SELECT name FROM sys.databases ORDER BY name"),
  tablesSql: () =>
    json(
      "SELECT t.TABLE_SCHEMA AS s, t.TABLE_NAME AS n, " +
        "CASE t.TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END AS k, " +
        "(SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = " +
        "OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME)) " +
        "AND p.index_id IN (0, 1)) AS r " +
        "FROM INFORMATION_SCHEMA.TABLES t ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME",
    ),
  routinesSql: () =>
    json(
      "SELECT ROUTINE_SCHEMA AS s, ROUTINE_NAME AS n, LOWER(ROUTINE_TYPE) AS k, " +
        "OBJECT_DEFINITION(OBJECT_ID(QUOTENAME(ROUTINE_SCHEMA) + '.' + " +
        "QUOTENAME(ROUTINE_NAME))) AS d FROM INFORMATION_SCHEMA.ROUTINES " +
        "ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME",
    ),
  columnsSql: (schema, table) =>
    json(
      "SELECT c.name AS n, TYPE_NAME(c.user_type_id) + CASE " +
        "WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'char', 'varbinary', 'binary') " +
        "THEN '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length AS VARCHAR(10))) + ')' " +
        "WHEN TYPE_NAME(c.user_type_id) IN ('nvarchar', 'nchar') " +
        "THEN '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length / 2 AS VARCHAR(10))) + ')' " +
        "WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric') " +
        "THEN '(' + CAST(c.precision AS VARCHAR(10)) + ',' + CAST(c.scale AS VARCHAR(10)) + ')' " +
        "ELSE '' END AS t, " +
        "IIF(c.is_nullable = 1, 1, 0) AS nl, " +
        "IIF(EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i " +
        "ON i.object_id = ic.object_id AND i.index_id = ic.index_id " +
        "WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id " +
        "AND ic.column_id = c.column_id), 1, 0) AS pk, " +
        "OBJECT_DEFINITION(c.default_object_id) AS df, " +
        "CONCAT(IIF(c.is_identity = 1, 'identity generated', ''), " +
        "IIF(c.is_computed = 1, 'computed generated', '')) AS x " +
        `FROM sys.columns c WHERE c.object_id = OBJECT_ID(${lit(`${q(schema || "dbo")}.${q(table)}`)}) ` +
        "ORDER BY c.column_id",
    ),
  indexesSql: (schema, table) =>
    json(
      "SELECT i.name AS n, CONCAT(IIF(i.is_unique = 1, 'UNIQUE ', ''), " +
        // Catalog names use a different collation than the database.
        "i.type_desc COLLATE DATABASE_DEFAULT, ' (', " +
        "STRING_AGG(c.name COLLATE DATABASE_DEFAULT, ', ') " +
        "WITHIN GROUP (ORDER BY ic.key_ordinal), ')') AS d " +
        "FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id " +
        "AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id " +
        "AND c.column_id = ic.column_id " +
        `WHERE i.object_id = OBJECT_ID(${lit(`${q(schema || "dbo")}.${q(table)}`)}) AND i.name IS NOT NULL ` +
        "GROUP BY i.name, i.is_unique, i.type_desc ORDER BY i.name",
    ),
  page: (ref, where, order, limit, offset) =>
    json(
      `SELECT * FROM ${ref}${where}${order || " ORDER BY (SELECT NULL)"} ` +
        `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
    ),
  counted: (statement) => `${statement}; SELECT @@ROWCOUNT AS n`,
  insertEmpty: (ref) => `INSERT INTO ${ref} DEFAULT VALUES`,
  versionSql:
    "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(64)) + ' ' + " +
    "CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS v",
  systemDatabases: ["master", "tempdb", "model", "msdb"],
};
