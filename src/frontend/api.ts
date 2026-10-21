import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import type {
  Affected,
  ConnectionInput,
  ConnectionView,
  Description,
  QueryResult,
  RowDelete,
  RowUpdate,
  RowWrite,
  RowsRequest,
  RowsView,
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
