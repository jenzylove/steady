import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "../memo/memo.js";
import type { Prediction } from "../engine/advice/types.js";
import type { AdapterContext } from "../engine/types.js";
import { Ledger } from "./store.js";
import { buildExitAtSize, buildLiquidationDistance, buildPegBand, buildRateDrift, impactCeiling, rateBand, rateStability, spreadPick } from "./make.js";
import { judge, outcomeFrom, scoreBoth, scoreOne, settleDue } from "./settle.js";
import { formatReport, summarize } from "./report.js";
import { frontierPrompt, parseFrontier } from "./frontier.js";

beforeAll(() => { process.env.MEMO_SIGNER_KEY ??= "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; });

const NOW = new Date("2026-11-26T10:00:00.000Z");
const SRC = { kind: "protocol_api" as const, ref: "fixture", fetchedAt: NOW.toISOString() };
const tmpLedger = () => new Ledger(join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.jsonl"));

describe("make builders", () => {
  it("rate band is 20% wide with a 0.5 point floor", () => {
    expect(rateBand(10)).toMatchObject({ lo: 8, hi: 12 });
    expect(rateBand(0.01)).toMatchObject({ lo: 0, hi: 0.51 });
  });
  it("rate_drift: stable history gives a stays inside call, volatile history does not", () => {
    const flat = Array.from({ length: 168 }, () => 4);
    const wild = Array.from({ length: 168 }, (_, i) => (i % 5 < 2 ? 1 : 9));
    expect(rateStability(flat, 72)).toEqual({ stable: 96, windows: 96 });
    const calm = buildRateDrift({ symbol: "USDC", mint: "m", reserve: "RESERVEXYZ", market: "mk", apyPct: 4, historyPct: flat }, NOW);
    const bad = buildRateDrift({ symbol: "USDC", mint: "m", reserve: "RESERVEXYZ", market: "mk", apyPct: 4, historyPct: wild }, NOW);
    expect(calm.steady.verdict).toBe(true);
    expect(bad.steady.verdict).toBe(false);
    expect(calm.settleAt).toBe("2026-11-29T10:00:00.000Z");
    expect(calm.params["lo"]).toBe(3.2);
    expect(typeof calm.params["question"]).toBe("string");
  });
  it("peg_band", () => {
    expect(buildPegBand({ symbol: "USDC", mint: "M1", price: 0.9998 }, NOW).steady.verdict).toBe(true);
    expect(buildPegBand({ symbol: "USDe", mint: "M2", price: 0.9955 }, NOW).steady.verdict).toBe(false);
    expect(buildPegBand({ symbol: "USDC", mint: "M1", price: 1 }, NOW).settleAt).toBe("2026-11-27T10:00:00.000Z");
  });
  it("exit_at_size picks the smallest ceiling 1.3x above current impact", () => {
    expect(impactCeiling(0.04)).toBe(0.1);
    expect(impactCeiling(0.3)).toBe(0.5);
    const p = buildExitAtSize({ pool: "POOLPOOL1", poolLabel: "Orca SOL/USDC", tokenIn: "S", symbol: "SOL", amount: 1000, usd: 100000, impactPct: 0.04 }, NOW);
    expect(p.steady.verdict).toBe(true);
    expect(p.params["maxImpactPct"]).toBe(0.1);
    expect(p.usdAtStake).toBe(100000);
  });
  it("liquidation_distance uses the collateral drop to health 1", () => {
    const safe = buildLiquidationDistance({ account: "ACC12345", owner: "W", health: 1.5, debtUsd: 9000, collateralUsd: 15000 }, NOW);
    const edge = buildLiquidationDistance({ account: "ACC12346", owner: "W", health: 1.03, debtUsd: 9000, collateralUsd: 9500 }, NOW);
    expect(safe.steady.verdict).toBe(true);
    expect(edge.steady.verdict).toBe(false);
    expect(safe.usdAtStake).toBe(9000);
    expect(safe.wallet).toBe("W");
  });
  it("spreadPick spreads over the list", () => {
    expect(spreadPick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([1, 3, 5, 7, 9]);
  });
});

describe("judge and score", () => {
  const rate = buildRateDrift({ symbol: "SOL", mint: "m", reserve: "RESERVEABC", market: "mk", apyPct: 4, historyPct: Array.from({ length: 168 }, () => 4) }, NOW);
  it("judges each kind against its own threshold", () => {
    expect(judge(rate, 3.5)).toBe(true);
    expect(judge(rate, 5)).toBe(false);
    const exit = buildExitAtSize({ pool: "POOLPOOL1", poolLabel: "x", tokenIn: "S", symbol: "SOL", amount: 1, usd: 1000, impactPct: 0.04 }, NOW);
    expect(judge(exit, 0.09)).toBe(true);
    expect(judge(exit, 0.1)).toBe(false);
    const liq = buildLiquidationDistance({ account: "ACC12345", owner: "W", health: 1.5, debtUsd: 1, collateralUsd: 2 }, NOW);
    expect(judge(liq, 1.0001)).toBe(true);
    expect(judge(liq, 0.99)).toBe(false);
  });
  it("scores hit and absolute error for both records", () => {
    const p: Prediction = { ...rate, frontier: { model: "m", verdict: false, value: 7, why: "guess" } };
    const outcome = outcomeFrom(p, 3.9, SRC, NOW);
    const s = scoreBoth(p, outcome);
    expect(s.steady.hit).toBe(true);
    expect(s.steady.absError).toBeCloseTo(0.1, 6);
    expect(s.frontier?.hit).toBe(false);
    expect(s.frontier?.absError).toBeCloseTo(3.1, 6);
    expect(scoreOne({ verdict: true }, outcome)).toEqual({ hit: true });
  });
});

describe("store", () => {
  it("appends signed memos, settles by digest, and refuses a second settlement", async () => {
    const l = tmpLedger();
    const p = buildPegBand({ symbol: "USDC", mint: "MINTMINT1", price: 1 }, NOW);
    const memo = await l.append(p);
    expect(await verify(memo)).toBe(true);
    await expect(l.append(p)).rejects.toThrow(/already exists/);
    const v2 = await l.update(p.id, { frontier: { model: "claude-sonnet-5-5", verdict: true, value: 1, why: "pegged" } });
    expect(v2.digest).not.toBe(memo.digest);
    const outcome = outcomeFrom(p, 0.9999, SRC, NOW);
    const s = await l.settle(p.id, outcome, scoreBoth({ ...p, frontier: v2.body.frontier }, outcome));
    expect(await verify(s)).toBe(true);
    expect(s.body.predictionDigest).toBe(v2.digest);
    const e = l.load();
    expect(e).toHaveLength(1);
    expect(e[0]!.prediction.outcome?.verdict).toBe(true);
    expect(e[0]!.prediction.frontier?.model).toBe("claude-sonnet-5-5");
    await expect(l.settle(p.id, outcome, s.body.score)).rejects.toThrow(/already settled/);
    await expect(l.update(p.id, {})).rejects.toThrow(/already settled/);
  });
});

describe("settleDue and report", () => {
  it("settles only due predictions with an injected read, then reports per kind", async () => {
    const l = tmpLedger();
    const due = buildPegBand({ symbol: "USDC", mint: "MINTMINT1", price: 1 }, NOW);
    const late = buildPegBand({ symbol: "USDT", mint: "MINTMINT2", price: 1 }, new Date(NOW.getTime() + 48 * 3600_000));
    await l.append({ ...due, frontier: { model: "m", verdict: false, value: 0.9, why: "guess" } });
    await l.append(late);
    const ctx = { now: () => new Date("2026-11-27T11:00:00.000Z") } as AdapterContext;
    const rep = await settleDue(l, ctx, ctx.now(), async () => ({ value: 1.0002, source: SRC }));
    expect(rep).toMatchObject({ settled: [due.id], notDue: 1 });
    const rows = summarize(l.load());
    const peg = rows.find((r) => r.kind === "peg_band")!;
    expect(peg).toMatchObject({ total: 2, settled: 1, open: 1 });
    expect(peg.steady.rate).toBe(1);
    expect(peg.frontier.rate).toBe(0);
    expect(peg.misses.map((m) => m.who)).toEqual(["frontier"]);
    expect(formatReport(rows, ctx.now())).toContain("peg_band: 2 predictions, 1 settled, 1 open");
  });
  it("keeps a prediction open when the fresh read fails", async () => {
    const l = tmpLedger();
    const p = buildPegBand({ symbol: "USDC", mint: "MINTMINT1", price: 1 }, NOW);
    await l.append(p);
    const now = new Date("2026-11-28T00:00:00.000Z");
    const rep = await settleDue(l, { now: () => now } as AdapterContext, now, async () => { throw new Error("no price"); });
    expect(rep.failed).toHaveLength(1);
    expect(l.load()[0]!.settlement).toBeUndefined();
  });
});

describe("frontier", () => {
  it("prompt carries only the date and the question", () => {
    const t = frontierPrompt("Will X?", NOW);
    expect(t).toContain("2026-11-26");
    expect(t).toContain("Will X?");
  });
  it("parses a JSON answer wrapped in prose", () => {
    expect(parseFrontier('Sure.\n{"verdict": true, "value": 4.2, "why": "stable"}')).toEqual({ verdict: true, value: 4.2, why: "stable" });
    expect(() => parseFrontier("no idea")).toThrow();
  });
});
