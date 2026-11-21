import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import type {
  Affected,
  ConnectionInput,
  ConnectionView,
  Description,
  MongoCollection,
  MongoFind,
  MongoPage,
  QueryResult,
  RedisKeyPage,
  RedisValue,
  RedisWrite,
  RowDelete,
  RowUpdate,
  RowWrite,
  RowsRequest,
  RowsView,
  RoutineEntry,
  TableEntry,
  TestResult,
  ToolsView,
} from "../shared/types";

let client: TermixApp["api"] | null = null;

export function initApi(api: TermixApp["api"]): void {
  client = api;
}

function api(): TermixApp["api"] {
  if (!client) throw new Error("Databases is not ready");
  return client;
}

/** The server's message for a failed call, or the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

export function errorCode(error: unknown): string {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response
    ?.data?.code;
  return typeof code === "string" ? code : "";
}

const base = (host: number, conn: number) => `/${host}/connections/${conn}`;

export async function getTools(host: number): Promise<ToolsView> {
  return (await api().get<ToolsView>(`/${host}/tools`)).data;
}

export async function listConnections(host: number): Promise<ConnectionView[]> {
  return (await api().get<ConnectionView[]>(`/${host}/connections`)).data;
}

export async function createConnection(
  host: number,
  body: ConnectionInput,
): Promise<ConnectionView> {
  return (await api().post<ConnectionView>(`/${host}/connections`, body)).data;
}

export async function updateConnection(
  host: number,
  id: number,
  body: ConnectionInput,
): Promise<ConnectionView> {
  return (await api().put<ConnectionView>(`/${host}/connections/${id}`, body))
    .data;
}

export async function deleteConnection(
  host: number,
  id: number,
): Promise<void> {
  await api().delete(`/${host}/connections/${id}`);
}

export async function testConnection(
  host: number,
  body: ConnectionInput & { id?: number },
): Promise<TestResult> {
  return (await api().post<TestResult>(`/${host}/connections/test`, body)).data;
}

export async function listDatabases(
  host: number,
  conn: number,
): Promise<string[]> {
  return (await api().get<string[]>(`${base(host, conn)}/databases`)).data;
}

export async function listTables(
  host: number,
  conn: number,
  db: string,
): Promise<TableEntry[]> {
  return (
    await api().get<TableEntry[]>(`${base(host, conn)}/tables`, {
      params: { db },
    })
  ).data;
}

export async function listRoutines(
  host: number,
  conn: number,
  db: string,
): Promise<RoutineEntry[]> {
  return (
    await api().get<RoutineEntry[]>(`${base(host, conn)}/routines`, {
      params: { db },
    })
  ).data;
}

export async function describeTable(
  host: number,
  conn: number,
  target: { db: string; schema: string; table: string },
): Promise<Description> {
  return (
    await api().get<Description>(`${base(host, conn)}/describe`, {
      params: target,
    })
  ).data;
}

export async function getRows(
  host: number,
  conn: number,
  body: RowsRequest,
): Promise<RowsView> {
  return (await api().post<RowsView>(`${base(host, conn)}/rows`, body)).data;
}

export async function insertRow(
  host: number,
  conn: number,
  body: RowWrite,
): Promise<Affected> {
  return (await api().post<Affected>(`${base(host, conn)}/row`, body)).data;
}

export async function updateRow(
  host: number,
  conn: number,
  body: RowUpdate,
): Promise<Affected> {
  return (await api().put<Affected>(`${base(host, conn)}/row`, body)).data;
}

export async function deleteRow(
  host: number,
  conn: number,
  body: RowDelete,
): Promise<Affected> {
  return (await api().post<Affected>(`${base(host, conn)}/row/delete`, body))
    .data;
}

export async function runQuery(
  host: number,
  conn: number,
  db: string,
  sql: string,
): Promise<QueryResult> {
  return (
    await api().post<QueryResult>(`${base(host, conn)}/query`, { db, sql })
  ).data;
}

export async function redisKeys(
  host: number,
  conn: number,
  db: string,
  pattern: string,
  cursor: string,
): Promise<RedisKeyPage> {
  return (
    await api().get<RedisKeyPage>(`${base(host, conn)}/redis/keys`, {
      params: { db, pattern, cursor },
    })
  ).data;
}

export async function redisValue(
  host: number,
  conn: number,
  db: string,
  key: string,
): Promise<RedisValue> {
  return (
    await api().get<RedisValue>(`${base(host, conn)}/redis/key`, {
      params: { db, key },
    })
  ).data;
}

export async function redisWrite(
  host: number,
  conn: number,
  db: string,
  write: RedisWrite,
): Promise<{ output: string }> {
  return (
    await api().post<{ output: string }>(`${base(host, conn)}/redis/write`, {
      db,
      ...write,
    })
  ).data;
}

export async function redisConsole(
  host: number,
  conn: number,
  db: string,
  line: string,
): Promise<{ output: string; readOnly: boolean }> {
  return (
    await api().post<{ output: string; readOnly: boolean }>(
      `${base(host, conn)}/redis/console`,
      { db, line },
    )
  ).data;
}

export async function mongoCollections(
  host: number,
  conn: number,
  db: string,
): Promise<MongoCollection[]> {
  return (
    await api().get<MongoCollection[]>(
      `${base(host, conn)}/mongo/collections`,
      {
        params: { db },
      },
    )
  ).data;
}

export async function mongoFind(
  host: number,
  conn: number,
  body: MongoFind,
): Promise<MongoPage> {
  return (await api().post<MongoPage>(`${base(host, conn)}/mongo/find`, body))
    .data;
}

export async function mongoIndexes(
  host: number,
  conn: number,
  db: string,
  collection: string,
): Promise<unknown[]> {
  return (
    await api().get<unknown[]>(`${base(host, conn)}/mongo/indexes`, {
      params: { db, collection },
    })
  ).data;
}

export async function mongoWrite(
  host: number,
  conn: number,
  action: "insert" | "replace" | "delete",
  body: { db: string; collection: string; id?: string; doc?: string },
): Promise<unknown> {
  return (await api().post(`${base(host, conn)}/mongo/${action}`, body)).data;
}

export async function mongoConsole(
  host: number,
  conn: number,
  db: string,
  code: string,
): Promise<{ output: string }> {
  return (
    await api().post<{ output: string }>(`${base(host, conn)}/mongo/console`, {
      db,
      code,
    })
  ).data;
}
