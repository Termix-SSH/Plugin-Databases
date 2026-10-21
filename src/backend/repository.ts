import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  PluginContext,
  PluginDatabase,
} from "@termix-ssh/plugin-sdk/backend";
import type {
  ConnectionInput,
  ConnectionView,
  EngineId,
} from "../shared/types.js";
import type { Conn } from "./engines/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Table = any;

export interface ConnectionRecord extends ConnectionView {
  hostId: number;
  passwordSealed: string | null;
}

function toRecord(row: any): ConnectionRecord {
  return {
    id: row.id,
    hostId: row.hostId,
    name: row.name,
    engine: row.kind as EngineId,
    address: row.address ?? "",
    port: row.port ?? null,
    username: row.username ?? "",
    hasPassword: Boolean(row.passwordSealed),
    passwordSealed: row.passwordSealed ?? null,
    database: row.dbName ?? "",
    runAs: row.runAs ?? "",
    readOnly: Boolean(row.readOnly),
  };
}

/** What the browser may see: no sealed password. */
export function toView(record: ConnectionRecord): ConnectionView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hostId, passwordSealed, ...view } = record;
  return view;
}

export function createRepository(
  ctx: PluginContext,
  db: PluginDatabase,
  table: Table,
) {
  const client = () => db.client<any>();

  function values(input: ConnectionInput) {
    return {
      name: input.name,
      kind: input.engine,
      address: input.address,
      port: input.port,
      username: input.username,
      dbName: input.database,
      runAs: input.runAs,
      readOnly: input.readOnly,
    };
  }

  return {
    async list(hostId: number): Promise<ConnectionRecord[]> {
      const rows = await (
        await client()
      )
        .select()
        .from(table)
        .where(eq(table.hostId, hostId));
      return rows.map(toRecord).sort((a: any, b: any) => a.id - b.id);
    },

    async get(hostId: number, id: number): Promise<ConnectionRecord | null> {
      const rows = await (
        await client()
      )
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.hostId, hostId)))
        .limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async create(
      hostId: number,
      userId: string,
      input: ConnectionInput,
    ): Promise<ConnectionRecord> {
      const uid = randomUUID();
      const drizzle = await client();
      await drizzle.insert(table).values({
        uid,
        hostId,
        userId,
        ...values(input),
        passwordSealed: input.password
          ? await ctx.secrets.seal(input.password)
          : null,
      });
      await db.persist();
      const rows = await drizzle
        .select()
        .from(table)
        .where(eq(table.uid, uid))
        .limit(1);
      return toRecord(rows[0]);
    },

    async update(
      existing: ConnectionRecord,
      input: ConnectionInput,
    ): Promise<void> {
      const set: Record<string, unknown> = values(input);
      if (input.password) {
        set.passwordSealed = await ctx.secrets.seal(input.password);
      } else if (input.clearPassword || input.engine === "sqlite") {
        set.passwordSealed = null;
      }
      await (
        await client()
      )
        .update(table)
        .set(set)
        .where(eq(table.id, existing.id));
      await db.persist();
    },

    async remove(id: number): Promise<void> {
      await (await client()).delete(table).where(eq(table.id, id));
      await db.persist();
    },

    /** The login with its password opened, for running a command. */
    async login(record: ConnectionRecord): Promise<Conn> {
      const password = record.passwordSealed
        ? ((await ctx.secrets.unseal(record.passwordSealed)) ?? "")
        : "";
      return {
        engine: record.engine,
        address: record.address,
        port: record.port,
        username: record.username,
        password,
        database: record.database,
        runAs: record.runAs,
      };
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
