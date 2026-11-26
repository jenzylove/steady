import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { AdapterContext } from "../engine/types.js";
import { poolLiquidity } from "../engine/pools/liquidity.js";
import { replayFetch, type RecordedCall } from "../engine/__fixtures__/replay.js";
import { createHandler, createMinerServer } from "./server.js";
import { resolvePool } from "./pools.js";

const ORCA = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const dir = new URL("../engine/__fixtures__/lp/", import.meta.url);

function recorded(name: string) {
  const fx: { recordedAt: string; expected: { usd: number }; calls: RecordedCall[] } = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  const ctx: AdapterContext = { heliusRpcUrl: "https://mainnet.helius-rpc.com/?api-key=TEST", fetch: replayFetch(fx.calls), now: () => new Date(fx.recordedAt) };
  return { fx, ctx };
}

describe("pool resolution", () => {
  it("accepts an address", () => {
    expect(resolvePool(ORCA)).toMatchObject({ ok: true, address: ORCA });
  });
  it("maps names to the known pools", () => {
    expect(resolvePool("Orca SOL/USDC")).toMatchObject({ ok: true, address: ORCA });
    expect(resolvePool("orca usdc-sol pool")).toMatchObject({ ok: true, address: ORCA });
    expect(resolvePool("Raydium SOL/USDC")).toMatchObject({ ok: true, address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2" });
    expect(resolvePool("Meteora SOL/USDC 0.1%")).toMatchObject({ ok: true, address: "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y" });
    expect(resolvePool("Meteora SOL-USDC 0.04%")).toMatchObject({ ok: true, address: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6" });
  });
  it("refuses a bare ambiguous pair, an unknown name and an EVM address", () => {
    const amb = resolvePool("SOL/USDC");
    expect(amb.ok).toBe(false);
    expect(resolvePool("Orca FOO/BAR")).toMatchObject({ ok: false, status: 404 });
    expect(resolvePool("0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("handler on recorded data", () => {
  it("answers Orca SOL/USDC with the recorded TVL, slot and sources", async () => {
    const { fx, ctx } = recorded("pool-orca");
    const handle = createHandler({ ctx: () => ctx, now: () => Date.parse(fx.recordedAt) });
    const r = await handle("Orca SOL/USDC", "solana");
    expect(r.status).toBe(200);
    const b = r.body as any;
    expect(b.liquidity_usd).toBeCloseTo(fx.expected.usd, 4);
    expect(b.pool).toBe(ORCA);
    expect(b.token_a.mint).toBe("So11111111111111111111111111111111111111112");
    expect(b.token_b.mint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(b.slot).toBeGreaterThan(400_000_000);
    expect(b.price_a).toBeGreaterThan(10);
    expect(b.price_b).toBeCloseTo(1, 1);
    expect(b.sources.some((s: any) => s.kind === "chain")).toBe(true);
    expect(JSON.stringify(b)).not.toContain("api-key");
  });

  it("serves raydium amm and meteora fixtures", async () => {
    const ray = recorded("pool-raydium-amm");
    const a = await createHandler({ ctx: () => ray.ctx })("58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", "Solana");
    expect(a.status).toBe(200);
    expect((a.body as any).dex).toBe("raydium-amm-v4");
    const met = recorded("pool-meteora");
    const m = await createHandler({ ctx: () => met.ctx })("Meteora SOL/USDC 0.1%", "solana");
    expect(m.status).toBe(200);
    expect((m.body as any).dex).toBe("meteora-dlmm");
  });

  it("caches an answer for 30 seconds", async () => {
    const { ctx } = recorded("pool-orca");
    let t = 1_000_000;
    const liquidity = vi.fn(poolLiquidity);
    const handle = createHandler({ ctx: () => ctx, liquidity, now: () => t });
    await handle(ORCA, "solana");
    t += 29_000;
    await handle(ORCA, "solana");
    expect(liquidity).toHaveBeenCalledTimes(1);
    t += 2_000;
    await handle(ORCA, "solana").catch(() => undefined);
    expect(liquidity).toHaveBeenCalledTimes(2);
  });

  it("rejects other chains and missing params with 400, never a number", async () => {
    const handle = createHandler({ ctx: () => recorded("pool-orca").ctx });
    for (const [pool, chain] of [[ORCA, "ethereum"], ["0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", "ethereum"], [null, "solana"], [ORCA, null], ["Orca FOO/BAR", "solana"]] as const) {
      const r = await handle(pool, chain);
      expect([400, 404]).toContain(r.status);
      expect(r.body.liquidity_usd).toBeUndefined();
      expect(String(r.body.reason).length).toBeGreaterThan(10);
    }
    expect((await handle(ORCA, "base")).status).toBe(400);
  });

  it("maps unpriced tokens to 422 and unsupported accounts to 400", async () => {
    const ctx = recorded("pool-orca").ctx;
    const unpriced = createHandler({
      ctx: () => ctx,
      liquidity: async () => ({
        pool: ORCA, dex: "orca-whirlpool", usd: null, sources: [], gaps: ["no USD price for MintX"],
        tokenA: { mint: "a", symbol: "A", vault: "v", amount: 1, usd: null }, tokenB: { mint: "b", symbol: "B", vault: "w", amount: 1, usd: 1 },
      }),
    });
    const r = await unpriced(ORCA, "solana");
    expect(r.status).toBe(422);
    expect(String(r.body.reason)).toContain("no USD price");
    const wrong = createHandler({ ctx: () => ctx, liquidity: async () => { throw new Error("pool X is owned by 111, not an Orca, Raydium or Meteora pool"); } });
    expect((await wrong(ORCA, "solana")).status).toBe(400);
    const gone = createHandler({ ctx: () => ctx, liquidity: async () => { throw new Error("pool X not found"); } });
    expect((await gone(ORCA, "solana")).status).toBe(404);
  });
});

describe("http server", () => {
  it("routes /health and /liquidity", async () => {
    const { ctx } = recorded("pool-orca");
    const server = createMinerServer({ ctx: () => ctx });
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(((await (await fetch(`${base}/health`)).json()) as any).status).toBe("ok");
      const ok = await fetch(`${base}/liquidity?pool=${encodeURIComponent("Orca SOL/USDC")}&chain=solana`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as any).liquidity_usd).toBeGreaterThan(1_000_000);
      expect((await fetch(`${base}/liquidity?pool=${ORCA}&chain=ethereum`)).status).toBe(400);
      expect((await fetch(`${base}/nope`)).status).toBe(404);
      await fetch(`${base}/liquidity?pool=${encodeURIComponent("Orca SOL/USDC")}&chain=solana`, { headers: { "x-steady-board": "1" } });
      const st = (await (await fetch(`${base}/stats`)).json()) as any;
      expect(st).toMatchObject({ answers: 1, refused: 1, boardReads: 1 });
      expect(typeof st.lastAnswerAt).toBe("string");
    } finally {
      server.close();
    }
  });
});

describe.skipIf(!process.env.LIVE)("live", () => {
  it("Orca SOL/USDC is within 1% of Orca's API TVL", async () => {
    const { makeContext } = await import("../engine/context.js");
    const handle = createHandler({ ctx: () => makeContext() });
    const r = await handle(ORCA, "solana");
    expect(r.status).toBe(200);
    const theirs = Number(((await (await fetch(`https://api.orca.so/v2/solana/pools/${ORCA}`)).json()) as any).data.tvlUsdc);
    const ours = (r.body as any).liquidity_usd as number;
    expect(Math.abs(ours - theirs) / theirs).toBeLessThan(0.01);
  });
});
