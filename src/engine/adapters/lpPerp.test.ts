import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterContext } from "../types.js";
import { replayFetch, type RecordedCall } from "../__fixtures__/replay.js";
import { orcaAdapter, decodePosition, decodeWhirlpool, bundledPositionPda, positionPda } from "./orca.js";
import { raydiumAdapter, decodeCpmm, decodePersonalPosition } from "./raydium.js";
import { meteoraAdapter, binPrice } from "./meteora.js";
import { driftAdapter } from "./drift.js";
import { jupiterPerpsAdapter, decodePerpPosition } from "./jupiterPerps.js";
import { clmmAmounts, tickToPrice } from "./lib.js";
import { poolLiquidity, parsePool } from "../pools/liquidity.js";
import { exitCost, constantProductOut } from "../risk/exit.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/lp");
const SOL = "So11111111111111111111111111111111111111112";

interface Fixture { recordedAt: string; expected: any; calls: RecordedCall[] }
function load(name: string): { fx: Fixture; ctx: AdapterContext } {
  const fx: Fixture = JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  const ctx: AdapterContext = {
    heliusRpcUrl: "https://mainnet.helius-rpc.com/?api-key=TEST",
    fetch: replayFetch(fx.calls),
    now: () => new Date(fx.recordedAt),
  };
  return { fx, ctx };
}
const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const sources = (p: any) => p.sources as { kind: string; ref: string; slot?: number; fetchedAt: string }[];

function checkSources(positions: any[]) {
  for (const p of positions) {
    expect(p.sources.length).toBeGreaterThan(0);
    for (const s of sources(p)) {
      expect(s.ref).not.toMatch(/api-key/i);
      expect(s.fetchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      if (s.kind === "chain") expect(s.slot).toBeGreaterThan(0);
    }
  }
}

describe("concentrated liquidity math", () => {
  it("in range position holds both tokens, below range only A, above range only B", () => {
    const sqrt = BigInt(Math.round(Math.sqrt(1.0001 ** 100) * 2 ** 32)) * 2n ** 32n; // tick 100
    const mid = clmmAmounts(1_000_000_000n, sqrt, 0, 200, 100);
    expect(mid.inRange).toBe(true);
    expect(mid.amountA).toBeGreaterThan(0);
    expect(mid.amountB).toBeGreaterThan(0);
    const below = clmmAmounts(1_000_000_000n, sqrt, 200, 400, 100);
    expect(below.inRange).toBe(false);
    expect(below.amountB).toBe(0);
    const above = clmmAmounts(1_000_000_000n, sqrt, -400, -200, 100);
    expect(above.amountA).toBe(0);
    expect(above.amountB).toBeGreaterThan(0);
  });
  it("tick to price applies decimals", () => {
    expect(tickToPrice(0, 9, 6)).toBeCloseTo(1000, 6);
  });
  it("dlmm bin price", () => {
    expect(binPrice(0, 10, 9, 6)).toBeCloseTo(1000, 6);
    expect(binPrice(10, 10, 6, 6)).toBeCloseTo(1.001 ** 10, 9);
  });
  it("constant product output", () => {
    expect(constantProductOut(100, 100, 1, 0)).toBeCloseTo(100 / 101, 9);
    expect(constantProductOut(100, 100, 1, 0.01)).toBeLessThan(constantProductOut(100, 100, 1, 0));
  });
});

describe("account decoders", () => {
  it("orca position and whirlpool offsets", () => {
    const b = Buffer.alloc(216);
    b.writeBigUInt64LE(123456789n, 72);
    b.writeInt32LE(-22624, 88);
    b.writeInt32LE(-22272, 92);
    b.writeBigUInt64LE(77n, 112);
    const p = decodePosition("x", b);
    expect(p.liquidity).toBe(123456789n);
    expect([p.tickLower, p.tickUpper, p.feeOwedA]).toEqual([-22624, -22272, 77n]);
    const w = Buffer.alloc(653);
    w.writeUInt16LE(64, 41);
    w.writeInt32LE(-26433, 81);
    expect(decodeWhirlpool("w", w)).toMatchObject({ tickSpacing: 64, tickCurrent: -26433 });
  });
  it("bundle and position PDAs are deterministic and distinct", () => {
    expect(bundledPositionPda(SOL, 0)).not.toBe(bundledPositionPda(SOL, 1));
    expect(positionPda(SOL)).toBe(positionPda(SOL));
  });
  it("jupiter perps position offsets", () => {
    const b = Buffer.alloc(216);
    b.writeUInt8(1, 152);
    b.writeBigUInt64LE(127_088_018n, 153);
    b.writeBigUInt64LE(3_559_185_720_945n, 161);
    b.writeBigUInt64LE(2_123_911_578_424n, 169);
    const p = decodePerpPosition("p", b);
    expect(p).toMatchObject({ side: "long", entryPrice: 127.088018, sizeUsd: 3559185.720945, collateralUsd: 2123911.578424 });
  });
  it("raydium offsets", () => {
    const b = Buffer.alloc(281);
    b.writeInt32LE(-14713, 73);
    b.writeInt32LE(-14693, 77);
    b.writeBigUInt64LE(5n, 81);
    expect(decodePersonalPosition("a", b)).toMatchObject({ tickLower: -14713, tickUpper: -14693, liquidity: 5n });
    expect(decodeCpmm(Buffer.alloc(637)).lpSupply).toBe(0n);
  });
  it("unknown owner is not a pool", () => {
    expect(parsePool("11111111111111111111111111111111", Buffer.alloc(10))).toBeNull();
  });
});

describe("adapters on recorded mainnet data", () => {
  it("orca: wallet with two positions", async () => {
    const { fx, ctx } = load("orca-multi");
    const r = await orcaAdapter.read("9z4rZ1hjspAXHkG8CSTXqAUk22kv19noDf7rvdTa5WHJ", ctx);
    expect(json(r)).toEqual(fx.expected);
    expect(r.positions).toHaveLength(2);
    expect(r.gaps).toEqual([]);
    for (const p of r.positions) {
      expect(p).toMatchObject({ protocol: "orca", kind: "lp" });
      expect(p.usd).toBeGreaterThan(1000);
      expect(typeof p.extra!.inRange).toBe("boolean");
      expect(p.extra!.tickLower as number).toBeLessThan(p.extra!.tickUpper as number);
    }
    checkSources(r.positions);
  });
  it("orca: position bundle yields bundled positions", async () => {
    const { ctx } = load("orca-bundle");
    const r = await orcaAdapter.read("J68JeFQVr4uCZP7WvWLHXAWVaLVFbFXNbFREh6vXtCVW", ctx);
    expect(r.positions.length).toBeGreaterThanOrEqual(10);
    expect(r.positions.every((p) => p.extra!.bundle)).toBe(true);
  });
  it("raydium: CLMM position out of range holds one token", async () => {
    const { fx, ctx } = load("raydium-clmm");
    const r = await raydiumAdapter.read("CorMxGXd3kGJw6sravC5US24TqrURQ6fq4QS3CymAwNV", ctx);
    expect(json(r)).toEqual(fx.expected);
    const p = r.positions[0]!;
    expect(p.extra!.type).toBe("clmm");
    expect(p.extra!.inRange).toBe(false);
    expect(p.usd).toBeGreaterThan(100);
    checkSources(r.positions);
  });
  it("raydium: standard AMM LP token valued by share of reserves", async () => {
    const { fx, ctx } = load("raydium-amm");
    const r = await raydiumAdapter.read("DgbCWnbXg43nmeiAveMCkUUPEpAr3rZo3iop3TyP6S63", ctx);
    expect(json(r)).toEqual(fx.expected);
    const p = r.positions[0]!;
    expect(p.extra!.type).toBe("standard-amm-v4");
    expect(p.extra!.shareOfPool as number).toBeGreaterThan(0.1);
    expect(p.usd).toBeGreaterThan(1_000_000);
  });
  it("meteora: DLMM position", async () => {
    const { fx, ctx } = load("meteora-dlmm");
    const r = await meteoraAdapter.read("9ZNSLCTLBkrCYfpBdnybhaWdmei6y1ysqXWpkb3dq2Hs", ctx);
    expect(json(r)).toEqual(fx.expected);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]!.protocol).toBe("meteora");
    expect(r.positions[0]!.usd).toBeGreaterThan(10);
    checkSources(r.positions);
  });
  it("drift: perp positions carry Drift's own margin numbers, stale oracles are flagged and not valued", async () => {
    const { fx, ctx } = load("drift-perp");
    const r = await driftAdapter.read("Fo2qidJ2rEkTJMc3W8hrQKQMxniaTw6M28NpQTuvVCAy", ctx);
    expect(json(r)).toEqual(fx.expected);
    const perps = r.positions.filter((p) => p.kind === "perp");
    expect(perps.length).toBeGreaterThan(0);
    for (const p of perps) {
      expect(p.extra).toHaveProperty("driftLiquidationPrice");
      expect(p.extra).toHaveProperty("driftMarginRatio");
      expect(p.extra).toHaveProperty("entryPrice");
      expect(p.extra).toHaveProperty("unrealizedPnlUsd");
      if (p.extra!.oracleStale) expect(p.usd).toBeUndefined();
    }
    if (perps.some((p) => p.extra!.oracleStale)) expect(r.gaps.join(" ")).toMatch(/oracle .* days ago/);
  });
  it("jupiter perps: long with Jupiter's liquidation price", async () => {
    const { fx, ctx } = load("jup-perp-sol");
    const r = await jupiterPerpsAdapter.read("8Mtzci2dVHHFe7kVkXFCt9NegD84scFwGLjUp1WRZzoH", ctx);
    expect(json(r)).toEqual(fx.expected);
    const p = r.positions[0]!;
    expect(p).toMatchObject({ protocol: "jupiter-perps", kind: "perp" });
    expect(p.extra).toMatchObject({ side: "long", entryPrice: 127.088018, sizeUsd: 3559185.720945 });
    expect(p.extra!.liquidationPrice).toBeGreaterThan(0);
    expect(p.amount).toBeGreaterThan(0);
    checkSources(r.positions);
  });
  it("jupiter perps: leveraged btc long", async () => {
    const { ctx } = load("jup-perp-btc");
    const r = await jupiterPerpsAdapter.read("8dXAExL3ikQHZ753aeH2ygjert68r7LQ9NzZXFpgfSk6", ctx);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]!.extra!.leverage as number).toBeGreaterThan(40);
  });
});

describe("pool liquidity and exit cost on recorded data", () => {
  it("orca SOL/USDC TVL is within 1% of Orca's own figure at record time", async () => {
    const { fx, ctx } = load("pool-orca");
    const r = await poolLiquidity(ctx, "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
    expect(json(r)).toEqual(fx.expected);
    expect(r.dex).toBe("orca-whirlpool");
    expect(r.usd).toBeGreaterThan(5_000_000);
    expect(r.gaps).toEqual([]);
  });
  it("raydium amm and meteora pools", async () => {
    expect((await poolLiquidity(load("pool-raydium-amm").ctx, "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2")).dex).toBe("raydium-amm-v4");
    expect((await poolLiquidity(load("pool-meteora").ctx, "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y")).dex).toBe("meteora-dlmm");
  });
  it("exit cost: constant product pool is exact, impact grows with size", async () => {
    const { fx, ctx } = load("exit-raydium-amm");
    const r = await exitCost(ctx, "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", SOL, 1000);
    expect(json(r)).toEqual(fx.expected);
    expect(r.inPool!.method).toBe("constant-product");
    expect(r.impactPct).toBeGreaterThan(0.1);
    expect(r.expectedOut).toBeGreaterThan(1000 * 10);
  });
  it("exit cost: orca pool priced through Jupiter on the same DEX, best route is cheaper", async () => {
    const { ctx } = load("exit-orca");
    const r = await exitCost(ctx, "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", SOL, 1000);
    expect(r.inPool!.method).toBe("jupiter-same-dex");
    expect(r.bestRoute!.impactPct).toBeLessThanOrEqual(r.inPool!.impactPct);
  });
  it("exit cost rejects a token that is not in the pool", async () => {
    const { ctx } = load("exit-orca");
    await expect(exitCost(ctx, "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", "11111111111111111111111111111111", 1)).rejects.toThrow(/not in pool/);
  });
});

describe.skipIf(!process.env.LIVE)("live mainnet (LIVE=1)", () => {
  it("orca SOL/USDC whirlpool TVL is in the expected range", async () => {
    const { makeContext } = await import("../context.js");
    const r = await poolLiquidity(makeContext(), "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
    expect(r.usd).toBeGreaterThan(8_000_000);
    expect(r.usd).toBeLessThan(40_000_000);
  }, 60_000);
  it("adapters return positions for known wallets", async () => {
    const { makeContext } = await import("../context.js");
    const ctx = makeContext();
    expect((await orcaAdapter.read("9z4rZ1hjspAXHkG8CSTXqAUk22kv19noDf7rvdTa5WHJ", ctx)).positions.length).toBeGreaterThan(0);
    expect((await jupiterPerpsAdapter.read("8Mtzci2dVHHFe7kVkXFCt9NegD84scFwGLjUp1WRZzoH", ctx)).positions.length).toBeGreaterThan(0);
    expect((await driftAdapter.read("Fo2qidJ2rEkTJMc3W8hrQKQMxniaTw6M28NpQTuvVCAy", ctx)).positions.length).toBeGreaterThan(0);
  }, 120_000);
});
