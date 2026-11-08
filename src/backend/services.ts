import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { EngineId } from "../shared/types.js";
import type { Repository } from "./repository.js";

/** A saved login as other plugins list it. No password. */
export interface DatabaseLoginSummary {
  id: number;
  name: string;
  engine: EngineId;
  database: string;
}

/** A saved login with its password, for running a dump on the host. */
export interface DatabaseLogin extends DatabaseLoginSummary {
  address: string;
  port: number | null;
  username: string;
  password: string;
  runAs: string;
}

export interface DatabaseLoginsV1 {
  list: (hostId: number) => Promise<DatabaseLoginSummary[]>;
  resolve: (hostId: number, id: number) => Promise<DatabaseLogin | null>;
}

/**
 * Saved logins for other plugins, such as Backups. Calls run as the caller's
 * acting user: listing needs connect access to the host, reading a password
 * needs edit access.
 */
export function registerServices(ctx: PluginContext, repo: Repository): void {
  if (typeof ctx.services?.provide !== "function") return;

  async function need(hostId: number, level: "connect" | "edit") {
    if (!ctx.currentActor()) {
      throw new Error("The databases service needs a calling user");
    }
    if (!Number.isInteger(hostId) || hostId < 1) {
      throw new Error("The host id is not valid");
    }
    if (!(await ctx.hosts.checkAccess(hostId, level)).hasAccess) {
      throw new Error("No access to this host");
    }
  }

  ctx.services.provide<DatabaseLoginsV1>("databases.logins", {
    async list(hostId) {
      await need(hostId, "connect");
      return (await repo.list(hostId)).map((record) => ({
        id: record.id,
        name: record.name,
        engine: record.engine,
        database: record.database,
      }));
    },
    async resolve(hostId, id) {
      await need(hostId, "edit");
      const record = await repo.get(hostId, id);
      if (!record) return null;
      const login = await repo.login(record);
      return {
        id: record.id,
        name: record.name,
        engine: login.engine,
        database: login.database,
        address: login.address,
        port: login.port,
        username: login.username,
        password: login.password,
        runAs: login.runAs,
      };
    },
  });
}
