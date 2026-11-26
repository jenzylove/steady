import { describe, expect, it } from "vitest";
import type { LoanAccount, LoanLeg } from "../types.js";
import { healthFactor, liquidationPrice } from "./health.js";

const leg = (mint: string, amount: number, price: number, factor: number): LoanLeg => ({ mint, symbol: mint, amount, usd: amount * price, factor });
const loan = (collaterals: LoanLeg[], borrows: LoanLeg[]): LoanAccount => ({ protocol: "test", account: "a", collaterals, borrows, sources: [] });

describe("healthFactor", () => {
  it("is weighted collateral over borrow factor weighted debt", () => {
    const l = loan([leg("SOL", 100, 100, 0.8), leg("USDC", 1000, 1, 0.9)], [leg("USDT", 4000, 1, 1.25)]);
    expect(healthFactor(l)).toBeCloseTo((8000 + 900) / 5000, 10);
  });
  it("is infinite without debt", () => {
    expect(healthFactor(loan([leg("SOL", 1, 100, 0.8)], []))).toBe(Infinity);
  });
});

describe("liquidationPrice", () => {
  it("finds the price where health reaches 1 with other prices fixed", () => {
    const l = loan([leg("SOL", 100, 100, 0.8)], [leg("USDC", 5000, 1, 1)]);
    const p = liquidationPrice(l, "SOL")!;
    expect(p).toBeCloseTo(62.5, 10);
    const at = loan([leg("SOL", 100, p, 0.8)], l.borrows);
    expect(healthFactor(at)).toBeCloseTo(1, 10);
  });
  it("accounts for other collateral held fixed", () => {
    const l = loan([leg("SOL", 100, 100, 0.8), leg("USDC", 1000, 1, 0.9)], [leg("USDT", 5000, 1, 1)]);
    expect(liquidationPrice(l, "SOL")).toBeCloseTo((5000 - 900) / 80, 10);
  });
  it("handles the same asset on both sides (looped position)", () => {
    const l = loan([leg("JITO", 100, 10, 0.9)], [leg("JITO", 50, 10, 1), leg("USDC", 200, 1, 1)]);
    // 90p = 50p + 200, so p = 5
    expect(liquidationPrice(l, "JITO")).toBeCloseTo(5, 10);
  });
  it("returns null when there is no debt, the mint is not collateral, or no price can liquidate", () => {
    expect(liquidationPrice(loan([leg("SOL", 1, 100, 0.8)], []), "SOL")).toBeNull();
    expect(liquidationPrice(loan([leg("SOL", 1, 100, 0.8)], [leg("USDC", 10, 1, 1)]), "BTC")).toBeNull();
    expect(liquidationPrice(loan([leg("SOL", 1, 100, 0.8), leg("USDC", 1000, 1, 1)], [leg("USDT", 10, 1, 1)]), "SOL")).toBeNull();
  });
});
