import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { HostSummary } from "../shared/types.js";
import type { Repository } from "./repository.js";
import type { Service } from "./service.js";

const CACHE_MS = 5 * 60_000;
const MAX_LOGINS = 8;
const HOST_CONCURRENCY = 3;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export interface SummaryCache {
  check: (hostId: number, refresh?: boolean) => Promise<HostSummary>;
}

/** Saved logins per host and whether each one answers, cached for 5 minutes. */
export function createSummaryCache(
  ctx: PluginContext,
  repo: Repository,
  service: Service,
): SummaryCache {
  const cache = new Map<string, HostSummary>();
  const key = (hostId: number) => `${ctx.currentActor() ?? ""}:${hostId}`;

  return {
    check: async (hostId, refresh = false) => {
      const cached = cache.get(key(hostId));
      if (
        !refresh &&
        cached &&
        Date.now() - Date.parse(cached.checkedAt) < CACHE_MS
      ) {
        return cached;
      }
      const checkedAt = new Date().toISOString();
      let fresh: HostSummary;
      try {
        const rows = (await repo.list(hostId)).slice(0, MAX_LOGINS);
        const logins: HostSummary["logins"] = [];
        for (const row of rows) {
          try {
            await service.test(hostId, await repo.login(row));
            logins.push({ id: row.id, name: row.name, ok: true });
          } catch (error) {
            logins.push({
              id: row.id,
              name: row.name,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        fresh = {
          hostId,
          checkedAt,
          total: rows.length,
          unreachable: logins.filter((l) => !l.ok).length,
          logins,
        };
      } catch (error) {
        fresh = {
          hostId,
          checkedAt,
          total: 0,
          unreachable: 0,
          logins: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
      cache.set(key(hostId), fresh);
      return fresh;
    },
  };
}

export function registerSummary(
  router: Router,
  ctx: PluginContext,
  repo: Repository,
  summary: SummaryCache,
): void {
  /**
   * @openapi
   * /plugin-api/databases/summary:
   *   get:
   *     summary: Database logins and reachability on every host
   *     description: One entry per host with Databases turned on and a saved login, checked as the caller and cached for 5 minutes unless refresh=1.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: query
   *         name: refresh
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: One entry per host.
   */
  router.get("/summary", async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === "1";
      const hostIds: number[] = [];
      for (const host of await ctx.hosts.list()) {
        const settings = await ctx.settings.getAll("host", host.id);
        if (
          settings.enableDatabases === true &&
          (await repo.list(host.id)).length
        ) {
          hostIds.push(host.id);
        }
      }
      res.json(
        await mapLimit(hostIds, HOST_CONCURRENCY, (hostId) =>
          summary.check(hostId, refresh),
        ),
      );
    } catch (error) {
      ctx.log.error(
        "Failed to build the databases summary",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to build the databases summary" });
    }
  });
}
