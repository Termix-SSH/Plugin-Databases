export type EngineId = "mysql" | "postgres" | "sqlite";

export const ENGINES: readonly EngineId[] = ["mysql", "postgres", "sqlite"];

/** A saved login as the browser sees it. The password is never sent back. */
export interface ConnectionView {
  id: number;
  name: string;
  engine: EngineId;
  address: string;
  port: number | null;
  username: string;
  hasPassword: boolean;
  database: string;
  runAs: string;
  readOnly: boolean;
}

export interface ConnectionInput {
  name: string;
  engine: EngineId;
  address: string;
  port: number | null;
  username: string;
  /** Empty keeps the saved password when editing. */
  password: string;
  clearPassword?: boolean;
  database: string;
  runAs: string;
  readOnly: boolean;
}

export interface ToolsView {
  mysql: string | null;
  psql: string | null;
  sqlite3: string | null;
}

export interface TestResult {
  version: string;
}

export interface TableEntry {
  schema: string;
  name: string;
  kind: "table" | "view";
  rows: number | null;
}

export interface RoutineEntry {
  schema: string;
  name: string;
  kind: "procedure" | "function";
  /** Null when the login may not read it. */
  definition: string | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  default: string | null;
  extra: string;
  /** False for binary and generated columns. */
  editable: boolean;
}

export interface IndexInfo {
  name: string;
  definition: string;
}

export interface TableTarget {
  db: string;
  schema: string;
  table: string;
}

export interface Grid {
  columns: string[];
  rows: Array<Array<string | null>>;
  truncated?: boolean;
}

export interface Description {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export interface RowsRequest extends TableTarget {
  limit: number;
  offset: number;
  orderBy: string;
  dir: "asc" | "desc";
  where: string;
}

export interface RowsView {
  columns: ColumnInfo[];
  grid: Grid;
  total: number;
}

export interface QueryResult extends Grid {
  elapsedMs: number;
  /** True when the session was read only. */
  readOnly: boolean;
}

export type RowValues = Record<string, string | null>;

export interface RowWrite extends TableTarget {
  values: RowValues;
}

export interface RowUpdate extends TableTarget {
  key: RowValues;
  values: RowValues;
}

export interface RowDelete extends TableTarget {
  key: RowValues;
}

export interface Affected {
  affected: number;
}
