import { describe, expect, it } from "vitest";
import { edgeSummary, isLiquidation } from "./edge.js";

describe("loans at the edge", () => {
  it("recognises a Kamino liquidation from the program logs", () => {
    expect(isLiquidation(["Program KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD invoke [1]", "Program log: Instruction: LiquidateObligationAndRedeemReserveCollateralV2"])).toBe(true);
    expect(isLiquidation(["Program log: Instruction: RepayObligationLiquidity"])).toBe(false);
  });
  it("sums only the loans that were liquidated after they were flagged", () => {
    const s = edgeSummary([
      { obligation: "a", owner: "o", firstSeenAt: "2026-11-27T00:00:00Z", firstHealth: 1.05, debtUsd: 100, liquidated: { at: "2026-11-28T00:00:00Z", signature: "s" } },
      { obligation: "b", owner: "o", firstSeenAt: "2026-11-27T03:00:00Z", firstHealth: 1.1, debtUsd: 50 },
    ]);
    expect(s).toEqual({ tracked: 2, trackedDebtUsd: 150, liquidated: 1, liquidatedDebtUsd: 100, since: "2026-11-27T00:00:00Z" });
  });
});
