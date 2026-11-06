import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createRemote } from "./remote.js";
import { createRepository } from "./repository.js";
import { registerRoutes } from "./routes.js";
import { createService } from "./service.js";
import { connections } from "./tables.js";
import { registerOperations } from "./operations.js";
import { registerServices } from "./services.js";
import { createSummaryCache, registerSummary } from "./summary.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(connections);
  const repo = createRepository(ctx, ctx.db, table);
  const service = createService(createRemote(ctx));
  const summary = createSummaryCache(ctx, repo, service);
  registerOperations(ctx, repo, service, summary);
  registerServices(ctx, repo);
  const router = ctx.http.router<Router>();
  registerRoutes(router, ctx, { repo, service });
  registerSummary(router, ctx, repo, summary);
  ctx.log.info("Databases routes mounted at /plugin-api/databases");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
