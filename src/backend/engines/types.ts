import type { EngineId, Grid } from "../../shared/types.js";

export interface Conn {
  engine: EngineId;
  address: string;
  port: number | null;
  username: string;
  password: string;
  /** The default database, or the file path for SQLite. */
  database: string;
  runAs: string;
}

export interface Engine {
  id: EngineId;
  /** The command line client on the host. */
  client: string;
  /** Env var the client reads the password from. */
  passwordEnv: string;
  /**
   * Bash lines that run "$SQL" and print the result. They read DB_ADDR,
   * DB_PORT, DB_USER, DB_NAME and DB_FILE, which the script sets.
   */
  run: (readOnly: boolean) => string[];
  parse: (output: string) => Grid;
  /** Quotes a table or column name. */
  q: (name: string) => string;
  /** A text value built without quoting, so it cannot break out. */
  lit: (value: string) => string;
  /** Wraps a text value for a column of the given type. */
  value: (text: string, type: string) => string;
  ref: (schema: string, table: string) => string;
  /** Statement that lists database names (one column). */
  databasesSql: string;
  /** schema, name, kind (table or view), rows. */
  tablesSql: (db: string) => string;
  /** name, type, nullable, primary, default, extra. */
  columnsSql: (schema: string, table: string) => string;
  /** name, definition. */
  indexesSql: (schema: string, table: string) => string;
  /** Runs a write and returns one row with the column n. */
  counted: (statement: string) => string;
  insertEmpty: (ref: string) => string;
  versionSql: string;
  systemDatabases: readonly string[];
}
