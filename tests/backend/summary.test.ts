import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createSummaryCache } from "../../src/backend/summary.js";
import type { Repository } from "../../src/backend/repository.js";
import type { Service } from "../../src/backend/service.js";

function setup(test: () => Promise<unknown>) {
  const ctx = { currentActor: () => "1" } as unknown as PluginContext;
  const repo = {
    list: vi.fn(async () => [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]),
    login: vi.fn(async (row: unknown) => row),
  } as unknown as Repository;
  const service = { test: vi.fn(test) } as unknown as Service;
  return { cache: createSummaryCache(ctx, repo, service), service };
}

describe("databases summary", () => {
  it("counts logins that do not answer", async () => {
    let n = 0;
    const { cache } = setup(async () => {
      if (n++ === 1) throw new Error("refused");
      return {};
    });
    const result = await cache.check(1);
    expect(result).toMatchObject({ total: 2, unreachable: 1 });
    expect(result.logins[1]).toMatchObject({ ok: false, error: "refused" });
  });

  it("caches the answer", async () => {
    const { cache, service } = setup(async () => ({}));
    await cache.check(1);
    await cache.check(1);
    expect(service.test).toHaveBeenCalledTimes(2);
    await cache.check(1, true);
    expect(service.test).toHaveBeenCalledTimes(4);
  });
});
