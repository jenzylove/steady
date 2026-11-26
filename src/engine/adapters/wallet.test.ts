import { describe, expect, it } from "vitest";
import { walletAdapter } from "./wallet.js";
import { loadFixture } from "./fixtures.js";

describe("wallet adapter (recorded fixtures)", () => {
  it("reads SOL, tokens and live delegations with sources", async () => {
    const { wallet, ctx } = loadFixture("wallet-tokens");
    const r = await walletAdapter.read(wallet, ctx);
    const sol = r.positions.find((p) => p.symbol === "SOL" && p.kind === "token")!;
    expect(sol.amount).toBeCloseTo(0.155263039, 9);
    expect(sol.sources[0]).toMatchObject({ kind: "chain", ref: "getBalance" });
    expect(sol.sources[0]!.slot).toBeGreaterThan(0);
    const tokens = r.positions.filter((p) => p.kind === "token");
    expect(tokens.length).toBeGreaterThan(20);
    for (const p of r.positions) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(JSON.stringify(s)).not.toMatch(/api-key/i);
    }
    const dels = r.positions.filter((p) => p.kind === "delegation");
    expect(dels.map((d) => d.symbol).sort()).toEqual(["KURO", "LDO", "SAMO"]);
    expect(dels.find((d) => d.symbol === "SAMO")!.extra).toMatchObject({ delegate: "4SMzSN8JUbrAnoMJ8D2Vst7qaLsDXBYpEQWvmTViqkGa" });
  });

  it("states unpriced tokens as a gap and leaves usd unset", async () => {
    const { wallet, ctx } = loadFixture("wallet-tokens");
    const r = await walletAdapter.read(wallet, ctx);
    expect(r.gaps.some((g) => g.includes("No Jupiter price"))).toBe(true);
    const unpriced = r.positions.filter((p) => p.kind === "token" && p.usd === undefined);
    expect(unpriced.length).toBeGreaterThan(0);
  });

  it("reports a gap, not a guess, when RPC fails", async () => {
    const ctx = { heliusRpcUrl: "https://x/?api-key=SECRET", now: () => new Date(), fetch: (async () => new Response("no", { status: 500 })) as typeof fetch };
    const r = await walletAdapter.read("11111111111111111111111111111111", ctx);
    expect(r.positions).toEqual([]);
    expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.gaps.join(" ")).not.toContain("SECRET");
  }, 30000);
});
