import type {
  Affected,
  ColumnInfo,
  Description,
  Grid,
  QueryResult,
  RowDelete,
  RowUpdate,
  RowWrite,
  RowsRequest,
  RowsView,
  RoutineEntry,
  TableEntry,
  TableTarget,
  TestResult,
  ToolsView,
} from "../shared/types.js";
import { DatabasesError } from "./errors.js";
import { getEngine, type Conn, type Engine } from "./engines/index.js";
import { sections } from "./engines/parse.js";
import { parseKeys, type Remote } from "./remote.js";
import { buildScript, TOOLS_SCRIPT } from "./script.js";
import { CONSOLE_ROWS, MAX_ROWS } from "./validate.js";

const BINARY = /blob|binary|bytea/i;

function toColumns(grid: Grid): ColumnInfo[] {
  return grid.rows.map(([name, type, nullable, primary, def, extra]) => ({
    name: name ?? "",
    type: type ?? "",
    nullable: nullable === "1",
    primary: primary === "1",
    default: def ?? null,
    extra: extra ?? "",
    editable: !BINARY.test(type ?? "") && !/generated/i.test(extra ?? ""),
  }));
}

export function createService(remote: Remote) {
  async function run(
    hostId: number,
    conn: Conn,
    db: string,
    statements: string[],
    readOnly: boolean,
  ): Promise<{ engine: Engine; parts: string[] }> {
    const engine = getEngine(conn.engine);
    const script = buildScript(engine, conn, db, statements, readOnly);
    const output = await remote.run(hostId, conn.runAs, script);
    return { engine, parts: sections(output) };
  }

  /** MySQL has no schema inside a database, so the database is the schema. */
  const schemaOf = (conn: Conn, target: TableTarget) =>
    conn.engine === "mysql" ? target.db : target.schema || "public";

  async function columnsOf(
    hostId: number,
    conn: Conn,
    target: TableTarget,
  ): Promise<ColumnInfo[]> {
    const schema = schemaOf(conn, target);
    const engine = getEngine(conn.engine);
    const { parts } = await run(
      hostId,
      conn,
      target.db,
      [engine.columnsSql(schema, target.table)],
      true,
    );
    const columns = toColumns(engine.parse(parts[0] ?? ""));
    if (columns.length === 0) {
      throw new DatabasesError("The table was not found", 404);
    }
    return columns;
  }

  function keyWhere(
    engine: Engine,
    columns: ColumnInfo[],
    key: Record<string, string | null>,
  ): string {
    const keyCols = columns.filter((c) => c.primary);
    if (keyCols.length === 0) {
      throw new DatabasesError(
        "This table has no primary key, so it is read only",
      );
    }
    return keyCols
      .map((c) => {
        const value = key[c.name];
        if (typeof value !== "string") {
          throw new DatabasesError(`The key value for ${c.name} is missing`);
        }
        return `${engine.q(c.name)} = ${engine.value(value, c.type)}`;
      })
      .join(" AND ");
  }

  function assignments(
    engine: Engine,
    columns: ColumnInfo[],
    values: Record<string, string | null>,
  ): Array<{ column: string; expr: string }> {
    return Object.entries(values).map(([name, value]) => {
      const col = columns.find((c) => c.name === name);
      if (!col) throw new DatabasesError(`The column ${name} was not found`);
      if (!col.editable) {
        throw new DatabasesError(`The column ${name} cannot be edited`);
      }
      return {
        column: engine.q(name),
        expr: value === null ? "NULL" : engine.value(value, col.type),
      };
    });
  }

  async function counted(
    hostId: number,
    conn: Conn,
    target: TableTarget,
    statement: (engine: Engine) => string,
  ): Promise<Affected> {
    const engine = getEngine(conn.engine);
    const { parts } = await run(
      hostId,
      conn,
      target.db,
      [engine.counted(statement(engine))],
      false,
    );
    const grid = engine.parse(parts[0] ?? "");
    return { affected: Number(grid.rows[0]?.[0] ?? 0) };
  }

  return {
    async tools(hostId: number): Promise<ToolsView> {
      const output = await remote.run(hostId, "", TOOLS_SCRIPT, 15_000);
      const keys = parseKeys(output);
      return {
        mysql: keys.mysql || null,
        psql: keys.psql || null,
        sqlite3: keys.sqlite3 || null,
      };
    },

    async test(hostId: number, conn: Conn): Promise<TestResult> {
      const engine = getEngine(conn.engine);
      const { parts } = await run(hostId, conn, "", [engine.versionSql], true);
      const grid = engine.parse(parts[0] ?? "");
      return { version: grid.rows[0]?.[0] ?? "" };
    },

    async databases(hostId: number, conn: Conn): Promise<string[]> {
      const engine = getEngine(conn.engine);
      const { parts } = await run(
        hostId,
        conn,
        "",
        [engine.databasesSql],
        true,
      );
      return engine
        .parse(parts[0] ?? "")
        .rows.map((row) => row[0] ?? "")
        .filter((name) => name && !engine.systemDatabases.includes(name));
    },

    async tables(
      hostId: number,
      conn: Conn,
      db: string,
    ): Promise<TableEntry[]> {
      const engine = getEngine(conn.engine);
      const { parts } = await run(
        hostId,
        conn,
        db,
        [engine.tablesSql(db)],
        true,
      );
      return engine
        .parse(parts[0] ?? "")
        .rows.map(([schema, name, kind, rows]) => ({
          schema: schema ?? "",
          name: name ?? "",
          kind: kind === "view" ? "view" : "table",
          rows: rows === null || rows === undefined ? null : Number(rows),
        }));
    },

    /** Stored procedures and functions. SQLite has none. */
    async routines(
      hostId: number,
      conn: Conn,
      db: string,
    ): Promise<RoutineEntry[]> {
      const engine = getEngine(conn.engine);
      if (!engine.routinesSql) return [];
      const { parts } = await run(
        hostId,
        conn,
        db,
        [engine.routinesSql(db)],
        true,
      );
      return engine
        .parse(parts[0] ?? "")
        .rows.map(([schema, name, kind, definition]) => ({
          schema: schema ?? "",
          name: name ?? "",
          kind: kind === "procedure" ? "procedure" : "function",
          definition: definition ?? null,
        }));
    },

    async describe(
      hostId: number,
      conn: Conn,
      target: TableTarget,
    ): Promise<Description> {
      const engine = getEngine(conn.engine);
      const schema = schemaOf(conn, target);
      const { parts } = await run(
        hostId,
        conn,
        target.db,
        [
          engine.columnsSql(schema, target.table),
          engine.indexesSql(schema, target.table),
        ],
        true,
      );
      return {
        columns: toColumns(engine.parse(parts[0] ?? "")),
        indexes: engine
          .parse(parts[1] ?? "")
          .rows.map(([name, definition]) => ({
            name: name ?? "",
            definition: definition ?? "",
          })),
      };
    },

    async rows(
      hostId: number,
      conn: Conn,
      req: RowsRequest & { where: string },
    ): Promise<RowsView> {
      const engine = getEngine(conn.engine);
      const schema = schemaOf(conn, req);
      const ref = engine.ref(schema, req.table);
      const where = req.where ? ` WHERE ${req.where}` : "";
      const order = req.orderBy
        ? ` ORDER BY ${engine.q(req.orderBy)} ${req.dir === "desc" ? "DESC" : "ASC"}`
        : "";
      const limit = Math.min(Math.max(req.limit, 1), MAX_ROWS);
      const offset = Math.max(req.offset, 0);
      const { parts } = await run(
        hostId,
        conn,
        req.db,
        [
          engine.columnsSql(schema, req.table),
          `SELECT COUNT(*) AS n FROM ${ref}${where}`,
          `SELECT * FROM ${ref}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
        ],
        true,
      );
      const columns = toColumns(engine.parse(parts[0] ?? ""));
      if (columns.length === 0) {
        throw new DatabasesError("The table was not found", 404);
      }
      return {
        columns,
        total: Number(engine.parse(parts[1] ?? "").rows[0]?.[0] ?? 0),
        grid: engine.parse(parts[2] ?? ""),
      };
    },

    async insert(hostId: number, conn: Conn, req: RowWrite): Promise<Affected> {
      const columns = await columnsOf(hostId, conn, req);
      return counted(hostId, conn, req, (engine) => {
        const ref = engine.ref(schemaOf(conn, req), req.table);
        const set = assignments(engine, columns, req.values);
        if (set.length === 0) return engine.insertEmpty(ref);
        return `INSERT INTO ${ref} (${set.map((s) => s.column).join(", ")}) VALUES (${set
          .map((s) => s.expr)
          .join(", ")})`;
      });
    },

    async update(
      hostId: number,
      conn: Conn,
      req: RowUpdate,
    ): Promise<Affected> {
      const columns = await columnsOf(hostId, conn, req);
      return counted(hostId, conn, req, (engine) => {
        const set = assignments(engine, columns, req.values);
        if (set.length === 0) throw new DatabasesError("Nothing to change");
        const ref = engine.ref(schemaOf(conn, req), req.table);
        return `UPDATE ${ref} SET ${set
          .map((s) => `${s.column} = ${s.expr}`)
          .join(", ")} WHERE ${keyWhere(engine, columns, req.key)}`;
      });
    },

    async remove(
      hostId: number,
      conn: Conn,
      req: RowDelete,
    ): Promise<Affected> {
      const columns = await columnsOf(hostId, conn, req);
      return counted(hostId, conn, req, (engine) => {
        const ref = engine.ref(schemaOf(conn, req), req.table);
        return `DELETE FROM ${ref} WHERE ${keyWhere(engine, columns, req.key)}`;
      });
    },

    async query(
      hostId: number,
      conn: Conn,
      db: string,
      sql: string,
      readOnly: boolean,
    ): Promise<QueryResult> {
      const started = Date.now();
      const { engine, parts } = await run(hostId, conn, db, [sql], readOnly);
      const grid = engine.parse(parts[0] ?? "");
      const truncated = grid.rows.length > CONSOLE_ROWS;
      return {
        columns: grid.columns,
        rows: truncated ? grid.rows.slice(0, CONSOLE_ROWS) : grid.rows,
        truncated,
        elapsedMs: Date.now() - started,
        readOnly,
      };
    },
  };
}

export type Service = ReturnType<typeof createService>;
