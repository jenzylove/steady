import { describe, expect, it } from "vitest";
import { decideEarly, projectHealth, type PriceAsk } from "./early.js";
import type { LoanAccount } from "../engine/types.js";
import type { QuorumResult } from "../telegraph/client.js";

const loan = (solAmount: number, solOracle: number, usdcDebt: number, coll = "SOL"): LoanAccount => ({
  protocol: "kamino", account: "OB", sources: [],
  collaterals: [{ mint: "So1", symbol: coll, amount: solAmount, usd: solAmount * solOracle, factor: 0.8 }],
  borrows: [{ mint: "EPj", symbol: "USDC", amount: usdcDebt, usd: usdcDebt, factor: 1 }],
});
const q = (value: number | undefined, signal = "0xsig"): QuorumResult<number> => ({
  intent: "CRYPTO_PRICE_USD", agreed: value !== undefined, value, costUsd: 0.03,
  answers: value === undefined ? [] : [{ intent: "CRYPTO_PRICE_USD", params: {}, ok: true, status: 200, ms: 1, role: "answer", used: true, value, signalHash: signal }],
});
const prices = (m: Record<string, number | undefined>): PriceAsk => async (s) => q(m[s]);

describe("early fire from Telegraph prices", () => {
  it("does not spend anything far from the line", async () => {
    let asked = 0;
    const d = await decideEarly(loan(10, 100, 500), 1.6, 1.15, async (s) => { asked++; return q(100); });
    expect(asked).toBe(0); expect(d.fire).toBe(false);
  });
  it("fires when agreed market prices already put the loan at the line", async () => {
    // Oracle SOL $100: health = 10*100*0.8/680 = 1.176. Market SOL $96: health 1.129, under the line 1.15.
    const d = await decideEarly(loan(10, 100, 680), 1.176, 1.15, prices({ SOL: 96, USDC: 1 }));
    expect(d.projected).toBeCloseTo((10 * 96 * 0.8) / 680, 6);
    expect(d.fire).toBe(true);
    expect(d.reason).toMatch(/SOL 96.000 on the market vs 100.00 on the oracle/);
  });
  it("does not fire when the market agrees with the oracle", async () => {
    const d = await decideEarly(loan(10, 100, 680), 1.176, 1.15, prices({ SOL: 100, USDC: 1 }));
    expect(d.fire).toBe(false);
  });
  it("never fires on prices the miners did not agree on", async () => {
    const d = await decideEarly(loan(10, 100, 680), 1.176, 1.15, prices({ SOL: undefined, USDC: 1 }));
    expect(d.fire).toBe(false);
    expect(d.checks.find((c) => c.symbol === "SOL")?.agreed).toBe(false);
  });
  it("prices a liquid staking token as SOL times its oracle exchange rate", async () => {
    const l = loan(10, 110, 680, "JitoSOL");
    const p = await projectHealth(l, prices({ SOL: 96, USDC: 1 }), 100);
    expect(p.checks.find((c) => c.symbol === "JitoSOL")?.market).toBeCloseTo(96 * 1.1, 6);
  });
  it("treats a debt stablecoin trading above a dollar as more debt", async () => {
    const d = await decideEarly(loan(10, 100, 680), 1.176, 1.15, prices({ SOL: 100, USDC: 1.03 }));
    expect(d.projected).toBeCloseTo(800 / (680 * 1.03), 6);
    expect(d.fire).toBe(true);
  });
});
