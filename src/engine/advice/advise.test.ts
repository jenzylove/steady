import { beforeEach, describe, expect, it, vi } from "vitest";

const ask = vi.fn();
vi.mock("../../telegraph/client.js", () => ({ ask: (...a: unknown[]) => ask(...a), quorum: vi.fn() }));

import { kaminoMainRates, newsCache, protocolAlerts } from "./advise.js";

const wallet = { positions: [{ protocol: "kamino" }], loans: [], gaps: [] } as any;
const answer = (text: string, ok = true) => ({ intent: "NEWS_SEARCH_GENERAL", params: {}, ok, status: 200, ms: 1, costUsd: 0.01, result: { answer: text } });

beforeEach(() => { ask.mockReset(); newsCache.clear(); });

describe("news answers are cached only when usable", () => {
  it("buys again after an empty answer", async () => {
    ask.mockResolvedValue(answer(""));
    await protocolAlerts(wallet);
    await protocolAlerts(wallet);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(newsCache.size).toBe(0);
  });
  it("buys again after an off topic answer", async () => {
    ask.mockResolvedValue(answer("Closest match only, not an exact answer."));
    await protocolAlerts(wallet);
    await protocolAlerts(wallet);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("reuses a usable answer", async () => {
    ask.mockResolvedValue(answer('Headlines: "Kamino lending volume rises to a new high this week"'));
    const first = await protocolAlerts(wallet);
    const second = await protocolAlerts(wallet);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(first.reused).toBe(0);
    expect(second.reused).toBe(1);
  });
});

describe("Kamino rate comes from the main market", () => {
  it("takes the deepest reserve per token and skips dust", async () => {
    const list = [
      { reserve: "dust", liquidityToken: "USDC", supplyApy: "0", totalSupplyUsd: "0.09" },
      { reserve: "deep", liquidityToken: "USDC", supplyApy: "0.0407", totalSupplyUsd: "164000000" },
      { reserve: "small", liquidityToken: "USDC", supplyApy: "0.108", totalSupplyUsd: "66" },
      { reserve: "sol", liquidityToken: "SOL", supplyApy: "0.05", totalSupplyUsd: "9e9" },
    ];
    const ctx = { fetch: async () => ({ json: async () => list }), now: () => new Date("2026-11-27T00:00:00Z") } as any;
    const rates = await kaminoMainRates(ctx);
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ protocol: "kamino", symbol: "USDC", pool: "deep" });
    expect(rates[0]!.apy).toBeCloseTo(4.07, 2);
    expect(rates[0]!.source.ref).toContain("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  });
});
