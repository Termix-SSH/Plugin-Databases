import type {
  PluginContext,
  PluginOperationContext,
} from "@termix-ssh/plugin-sdk/backend";
import type { Repository } from "./repository.js";
import type { Service } from "./service.js";

function requireHost(context: PluginOperationContext): number {
  if (context.hostId === undefined) throw new Error("This needs a host");
  return context.hostId;
}

/** Saved database logins as actions: list them across hosts and check one. */
export function registerOperations(
  ctx: PluginContext,
  repo: Repository,
  service: Service,
): void {
  if (typeof ctx.operations?.register !== "function") return;

  ctx.operations.register("databases.list-connections", {
    run: async (_input, context) => {
      const rows = await repo.list(requireHost(context));
      return {
        summary: `${rows.length} database logins`,
        data: {
          rows: rows.map((row) => ({
            id: String(row.id),
            name: row.name,
            engine: row.engine,
            database: row.database,
            access: row.readOnly ? "read only" : "read and write",
          })),
          value: rows.length,
          status: "ok",
          label: `${rows.length} logins`,
        },
      };
    },
  });

  ctx.operations.register("databases.check-connection", {
    run: async (_input, context) => {
      const hostId = requireHost(context);
      const id = Number(context.resourceKey);
      const record = Number.isInteger(id) ? await repo.get(hostId, id) : null;
      if (!record) throw new Error("Database login not found");
      const found = await service.databases(hostId, await repo.login(record));
      return {
        summary: `${record.name} works, ${found.length} databases`,
        data: {
          value: found.length,
          status: "ok",
          label: `${found.length} databases`,
          databases: found,
        },
      };
    },
  });
}
