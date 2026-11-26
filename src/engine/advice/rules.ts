// Pure rules: positions and loans in, findings out. No network, no model. Every number shown comes from here.
import type { AdapterResult, LoanAccount, Position } from "../types.js";
import type { Finding, Severity } from "./types.js";
import { healthFactor, liquidationPrice, weightedCollateral, weightedDebt } from "../risk/health.js";

export const STABLES: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
  DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT: "USDe",
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: "USDS",
};

export const LIMITS = {
  healthCritical: 1.1,
  healthHigh: 1.25,
  healthTarget: 1.5,
  pegBand: 0.01, // 1% off $1
  concentration: 0.6, // one asset over 60% of priced value
};

const id = (kind: string, code: string, key: string) => `${kind}:${code}:${key}`;

export function totalUsd(r: AdapterResult): number {
  const pos = r.positions.reduce((s, p) => s + (p.kind === "borrow" ? -(p.usd ?? 0) : p.usd ?? 0), 0);
  return Math.round(pos * 100) / 100;
}

/** USD to repay on `leg` so health reaches `target`, or 0 if already there. */
export function repayToTarget(loan: LoanAccount, legMint: string, target = LIMITS.healthTarget): number {
  const leg = loan.borrows.find((b) => b.mint === legMint);
  if (!leg) return 0;
  const need = weightedDebt(loan) - weightedCollateral(loan) / target;
  if (need <= 0) return 0;
  return Math.min(leg.usd, need / leg.factor);
}

export function loanFindings(loans: LoanAccount[]): Finding[] {
  const out: Finding[] = [];
  for (const loan of loans) {
    if (loan.borrows.length === 0) continue;
    const h = healthFactor(loan);
    if (!Number.isFinite(h)) continue;
    const sev: Severity = h < LIMITS.healthCritical ? "critical" : h < LIMITS.healthHigh ? "high" : h < LIMITS.healthTarget ? "medium" : "info";
    const mainCol = [...loan.collaterals].sort((a, b) => b.usd - a.usd)[0];
    const price = mainCol && mainCol.amount > 0 ? mainCol.usd / mainCol.amount : undefined;
    const liq = mainCol ? liquidationPrice(loan, mainCol.mint) : null;
    const distance = liq !== null && price ? (price - liq) / price : undefined;
    const repayLeg = [...loan.borrows].sort((a, b) => (STABLES[b.mint] ? 1 : 0) - (STABLES[a.mint] ? 1 : 0) || b.usd - a.usd)[0];
    const repayUsd = repayLeg ? repayToTarget(loan, repayLeg.mint) : 0;
    const numbers: Record<string, number | string> = { health: round(h, 3), collateralUsd: round(loan.collaterals.reduce((s, c) => s + c.usd, 0), 2), debtUsd: round(loan.borrows.reduce((s, b) => s + b.usd, 0), 2) };
    if (mainCol) numbers.mainCollateral = mainCol.symbol;
    if (price) numbers.price = round(price, 4);
    if (liq !== null) numbers.liquidationPrice = round(liq, 4);
    if (distance !== undefined) numbers.distancePct = round(distance * 100, 2);
    if (loan.protocolReported?.healthFactor) numbers.protocolHealth = round(loan.protocolReported.healthFactor, 3);
    const title = liq !== null && mainCol
      ? `${loan.protocol} loan liquidates if ${mainCol.symbol} falls to $${fmt(liq)} (${fmt((distance ?? 0) * 100)}% away)`
      : `${loan.protocol} loan health ${fmt(h)}`;
    const f: Finding = { id: id("risk", "liquidation_near", loan.account), kind: "risk", code: "liquidation_near", severity: sev, title, numbers, sources: loan.sources, evidence: [] };
    if (repayLeg && repayUsd > 0 && sev !== "info") {
      const amount = repayUsd / (repayLeg.usd / repayLeg.amount);
      f.fix = { action: "repay", protocol: loan.protocol, account: loan.account, mintIn: repayLeg.mint, amount: round(amount, 6), reason: `Repay ${fmt(amount)} ${repayLeg.symbol} to lift health from ${fmt(h)} to ${LIMITS.healthTarget}`, expected: { metric: "health", before: round(h, 3), after: LIMITS.healthTarget } };
    }
    out.push(f);
  }
  return out;
}

export function holdingFindings(positions: Position[]): Finding[] {
  const out: Finding[] = [];
  const held = positions.filter((p) => p.kind !== "borrow" && p.kind !== "delegation");
  const priced = held.filter((p) => (p.usd ?? 0) > 0);
  const total = priced.reduce((s, p) => s + (p.usd ?? 0), 0);

  // Depeg: stablecoins whose own priced value per token is off $1 beyond the band.
  for (const p of held) {
    const sym = p.mint ? STABLES[p.mint] : undefined;
    if (!sym || !p.usd || p.amount <= 0) continue;
    const px = p.usd / p.amount;
    if (Math.abs(px - 1) > LIMITS.pegBand) {
      out.push({ id: id("risk", "depeg", `${p.protocol}:${p.mint}`), kind: "risk", code: "depeg", severity: Math.abs(px - 1) > 0.03 ? "high" : "medium", title: `${sym} is trading at $${fmt(px)}, off its $1 peg`, numbers: { symbol: sym, price: round(px, 4), amount: round(p.amount, 2), usd: round(p.usd, 2) }, sources: p.sources, evidence: [] });
    }
  }

  // Concentration by mint across wallet, LST and protocol deposits.
  const byMint = new Map<string, { usd: number; symbol: string; sources: Position["sources"] }>();
  for (const p of priced) {
    const k = p.mint ?? `${p.protocol}:${p.account}`;
    const e = byMint.get(k) ?? { usd: 0, symbol: p.symbol ?? k.slice(0, 6), sources: [] };
    e.usd += p.usd ?? 0; e.sources.push(...p.sources); byMint.set(k, e);
  }
  for (const [mint, e] of byMint) {
    if (total > 50 && e.usd / total > LIMITS.concentration && !STABLES[mint]) {
      out.push({ id: id("risk", "concentration", mint), kind: "risk", code: "concentration", severity: "medium", title: `${fmt((e.usd / total) * 100)}% of your value is in ${e.symbol}`, numbers: { symbol: e.symbol, sharePct: round((e.usd / total) * 100, 1), usd: round(e.usd, 2), totalUsd: round(total, 2) }, sources: e.sources.slice(0, 3), evidence: [] });
    }
  }

  // Live token delegations: someone else can move these tokens.
  for (const p of positions.filter((x) => x.kind === "delegation")) {
    const delegate = String(p.extra?.delegate ?? "");
    const tokenAccount = String(p.extra?.tokenAccount ?? p.account ?? "");
    out.push({
      id: id("risk", "live_delegation", tokenAccount), kind: "risk", code: "live_delegation", severity: (p.usd ?? 0) > 100 ? "high" : "medium",
      title: `Another program can move ${fmt(p.amount)} ${p.symbol ?? "tokens"} from your wallet`,
      numbers: { symbol: p.symbol ?? "", amount: round(p.amount, 6), delegate, tokenAccount },
      sources: p.sources, evidence: [],
      fix: { action: "revoke", protocol: "wallet", account: tokenAccount, ...(p.mint ? { mintIn: p.mint } : {}), amount: p.amount, reason: `Revoke the delegation to ${delegate.slice(0, 4)}…${delegate.slice(-4)}` },
    });
  }

  // Positions whose protocol data is frozen (for example stale oracles).
  for (const p of positions.filter((x) => x.extra?.oracleStale)) {
    out.push({ id: id("risk", "stale_protocol", `${p.protocol}:${p.account}`), kind: "risk", code: "stale_protocol", severity: "high", title: `${p.protocol} prices for this position have not updated, so its real value and risk are unknown`, numbers: { protocol: p.protocol, account: p.account ?? "" }, sources: p.sources, evidence: [] });
  }
  return out;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
function fmt(n: number): string {
  const a = Math.abs(n);
  return a >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : a >= 1 ? n.toFixed(2) : n.toPrecision(3);
}
