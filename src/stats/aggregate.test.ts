import { describe, expect, it } from "vitest";
import { evalBlock, ledgerBlock, makeStats, nodeMinerBlock } from "./aggregate.js";

const entry = (id: string, settleAt: string, steady: boolean, outcome?: boolean, frontier?: boolean): any => ({
  prediction: {
    id, kind: "peg_band", subject: "x", claim: "c", params: {}, madeAt: "2026-11-26T09:00:00Z", settleAt,
    steady: { verdict: steady, value: 1, why: "" },
    ...(frontier === undefined ? {} : { frontier: { model: "m", verdict: frontier, why: "" } }),
    ...(outcome === undefined ? {} : { outcome: { verdict: outcome, value: 1, settledAt: settleAt, source: { kind: "chain", ref: "r", fetchedAt: settleAt } } }),
  },
  memo: {},
});

describe("stats", () => {
  it("scores the ledger", () => {
    const now = Date.parse("2026-11-27T00:00:00Z");
    const b = ledgerBlock([entry("a", "2026-11-26T10:00:00Z", true, true, false), entry("b", "2026-11-26T11:00:00Z", true, false, false), entry("c", "2026-11-27T09:00:00Z", true)], [{}, {}, {}, {}] as any, now);
    expect(b).toMatchObject({ predictions: 3, open: 1, settled: 2, steadyHits: 1, frontierSettled: 2, frontierHits: 1, nextSettleAt: "2026-11-27T09:00:00Z", signedMemos: 4, overdue: 0 });
  });
  it("finds our miner and counts rivals", () => {
    const all = [{ id: "7420317", activation_status: "active", supported_intents: ["LIQUIDITY_DEPTH_VERIFY_GENERAL"], scored: false }, { id: "9", supported_intents: ["LIQUIDITY_DEPTH_VERIFY_GENERAL"] }, { id: "1", supported_intents: [] }];
    expect(nodeMinerBlock(all)).toMatchObject({ found: true, status: "active", requestsServed: 0, scored: false, rank: null, rivals: 2 });
    expect(evalBlock({ rows: [{ intent_id: "A", status: "eligible" }, { intent_id: "A", status: "pending" }] })).toMatchObject({ rows: 2, eligible: 1, byIntent: { A: 2 } });
  });
  it("never throws when sources are down, and keeps the last good value", async () => {
    let up = true;
    let t = 0;
    const f = (async (url: string) => {
      if (!up) throw new Error("down");
      const body = url.includes("/api/miners") ? [{ id: "7420317", supported_intents: [] }] : url.includes("evalpool") ? { rows: [] } : { answers: 3 };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const stats = makeStats({ fetch: f, now: () => t, ledger: () => ({ entries: [], lines: [] }), spend: () => ({ spentUsd: 0, capUsd: 5 }), node: "n", minerUrl: "m", botUrl: "b", bootedAt: "x" });
    const a = await stats();
    expect(a.miner).toMatchObject({ ok: true, answers: 3 });
    expect(a.bot).toMatchObject({ ok: true });
    up = false; t = 60_000;
    const b = await stats();
    expect(b.miner).toMatchObject({ ok: true, answers: 3 }); // last good value, with its own read time
    expect(b.ledger).toMatchObject({ ok: true, predictions: 0 });
  });
});
