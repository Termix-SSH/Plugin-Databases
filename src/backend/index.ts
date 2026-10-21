import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createRemote } from "./remote.js";
import { createRepository } from "./repository.js";
import { registerRoutes } from "./routes.js";
import { createService } from "./service.js";
import { connections } from "./tables.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(connections);
  const repo = createRepository(ctx, ctx.db, table);
  const service = createService(createRemote(ctx));
  registerRoutes(ctx.http.router<Router>(), ctx, { repo, service });
  ctx.log.info("Databases routes mounted at /plugin-api/databases");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
