export type SqlEngineId = "mysql" | "postgres" | "sqlite" | "mssql";
export type EngineId = SqlEngineId | "redis" | "mongo";

export const SQL_ENGINES: readonly SqlEngineId[] = [
  "mysql",
  "postgres",
  "sqlite",
  "mssql",
];
export const ENGINES: readonly EngineId[] = [...SQL_ENGINES, "redis", "mongo"];

export function isSqlEngine(engine: EngineId): engine is SqlEngineId {
  return (SQL_ENGINES as readonly string[]).includes(engine);
}

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
  sqlcmd: string | null;
  "redis-cli": string | null;
  mongosh: string | null;
}

/** The client each engine runs on the host. */
export const ENGINE_CLIENT: Record<EngineId, keyof ToolsView> = {
  mysql: "mysql",
  postgres: "psql",
  sqlite: "sqlite3",
  mssql: "sqlcmd",
  redis: "redis-cli",
  mongo: "mongosh",
};

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

export interface ResultSet extends Grid {
  /** The statement that gave this result. */
  statement: string;
  truncated: boolean;
}

export interface QueryResult extends Grid {
  elapsedMs: number;
  /** True when the session was read only. */
  readOnly: boolean;
  /** One result per statement, when several reads ran. */
  sets?: ResultSet[];
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

/** One host's saved logins and whether each answers. */
export interface HostSummary {
  hostId: number;
  checkedAt: string;
  total: number;
  unreachable: number;
  logins: Array<{ id: number; name: string; ok: boolean; error?: string }>;
  error?: string;
}

export interface RedisInfo {
  version: string;
  databases: Array<{ index: number; keys: number }>;
}

export interface RedisKey {
  key: string;
  type: string;
  /** Milliseconds left, -1 for no expiry, -2 when the key is gone. */
  ttl: number;
}

export interface RedisKeyPage {
  /** "0" when the scan is done. */
  cursor: string;
  keys: RedisKey[];
}

export interface RedisValue {
  type: string;
  ttl: number;
  size: number;
  truncated?: boolean;
  value?: string;
  fields?: Array<{ field: string; value: string }>;
  items?: string[];
  members?: Array<{ member: string; score: string }>;
  entries?: Array<{ id: string; fields: Record<string, string> }>;
}

export type RedisWriteOp =
  | "set"
  | "delete"
  | "rename"
  | "expire"
  | "hset"
  | "hdel"
  | "rpush"
  | "lset"
  | "lrem"
  | "sadd"
  | "srem"
  | "zadd"
  | "zrem";

export interface RedisWrite {
  op: RedisWriteOp;
  key: string;
  value?: string;
  field?: string;
  newKey?: string;
  ttl?: number | null;
  index?: number;
  score?: number;
}

export interface MongoCollection {
  name: string;
  type: string;
  count: number | null;
}

export interface MongoFind {
  db: string;
  collection: string;
  /** Extended JSON text. */
  filter: string;
  sort: string;
  skip: number;
  limit: number;
}

export interface MongoPage {
  /** Each document as relaxed Extended JSON text. */
  docs: string[];
  total: number | null;
}
