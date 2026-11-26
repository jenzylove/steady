import type { LoanAccount } from "../types.js";

/** Sum of collateral usd weighted by liquidation threshold. */
export function weightedCollateral(loan: LoanAccount): number {
  return loan.collaterals.reduce((s, l) => s + l.usd * l.factor, 0);
}

/** Sum of borrow usd weighted by borrow factor. */
export function weightedDebt(loan: LoanAccount): number {
  return loan.borrows.reduce((s, l) => s + l.usd * l.factor, 0);
}

/**
 * healthFactor = sum(collateral usd * liquidation threshold) / sum(borrow usd * borrow factor).
 * Below 1 the account can be liquidated. Infinity when there is no debt.
 */
export function healthFactor(loan: LoanAccount): number {
  const debt = weightedDebt(loan);
  if (debt <= 0) return Number.POSITIVE_INFINITY;
  return weightedCollateral(loan) / debt;
}

/**
 * Price of `mint` (USD per token) at which healthFactor reaches 1, every other price held fixed.
 * Handles the mint appearing on both sides (a looped position). Returns null when the mint is not
 * collateral, there is no debt, or no positive price can bring the account to 1.
 */
export function liquidationPrice(loan: LoanAccount, mint: string): number | null {
  const col = loan.collaterals.filter((l) => l.mint === mint);
  if (col.length === 0) return null;
  const bor = loan.borrows.filter((l) => l.mint === mint);
  const colWeightPerUsdPrice = col.reduce((s, l) => s + l.amount * l.factor, 0);
  const borWeightPerUsdPrice = bor.reduce((s, l) => s + l.amount * l.factor, 0);
  const otherCol = loan.collaterals.filter((l) => l.mint !== mint).reduce((s, l) => s + l.usd * l.factor, 0);
  const otherDebt = loan.borrows.filter((l) => l.mint !== mint).reduce((s, l) => s + l.usd * l.factor, 0);
  if (otherDebt <= 0 && borWeightPerUsdPrice <= 0) return null;
  // p * colW + otherCol = otherDebt + p * borW  =>  p = (otherDebt - otherCol) / (colW - borW)
  const denom = colWeightPerUsdPrice - borWeightPerUsdPrice;
  const num = otherDebt - otherCol;
  if (denom <= 0) return null; // falling price never reduces net weight enough
  const p = num / denom;
  return p > 0 ? p : null;
}
