import { describe, it, expect } from "vitest";
import { loanFindings, holdingFindings, repayToTarget } from "./rules.js";
import { healthFactor } from "../risk/health.js";
import type { LoanAccount, Position } from "../types.js";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const src = [{ kind: "chain" as const, ref: "test", fetchedAt: "2026-11-26T00:00:00Z" }];

const loan: LoanAccount = {
  protocol: "kamino", account: "OBL1",
  collaterals: [{ mint: SOL, symbol: "SOL", amount: 10, usd: 700, factor: 0.8 }],
  borrows: [{ mint: USDC, symbol: "USDC", amount: 500, usd: 500, factor: 1 }],
  sources: src,
};

describe("loan rules", () => {
  it("health 1.12 is high risk with liquidation price and a repay that reaches 1.5", () => {
    const [f] = loanFindings([loan]);
    expect(f!.severity).toBe("high");
    expect(f!.numbers.health).toBe(1.12);
    expect(f!.numbers.liquidationPrice).toBe(62.5); // 10 * p * 0.8 = 500
    expect(f!.fix?.action).toBe("repay");
    const repay = repayToTarget(loan, USDC);
    const after = healthFactor({ ...loan, borrows: [{ ...loan.borrows[0]!, usd: 500 - repay, amount: 500 - repay }] });
    expect(after).toBeCloseTo(1.5, 6);
  });
  it("healthy loan is info and carries no fix", () => {
    const [f] = loanFindings([{ ...loan, borrows: [{ ...loan.borrows[0]!, usd: 100, amount: 100 }] }]);
    expect(f!.severity).toBe("info");
    expect(f!.fix).toBeUndefined();
  });
});

describe("holding rules", () => {
  it("flags depeg, concentration and live delegation", () => {
    const pos: Position[] = [
      { protocol: "wallet", kind: "token", mint: "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", symbol: "USDe", amount: 100, usd: 96, sources: src },
      { protocol: "wallet", kind: "token", mint: SOL, symbol: "SOL", amount: 20, usd: 1400, sources: src },
      { protocol: "wallet", kind: "delegation", mint: USDC, symbol: "USDC", amount: 250, usd: 250, extra: { delegate: "DeLeGaTe1111111111111111111111111111111111", tokenAccount: "TA1" }, sources: src },
    ];
    const codes = holdingFindings(pos).map((f) => f.code).sort();
    expect(codes).toEqual(["concentration", "depeg", "live_delegation"]);
    expect(holdingFindings(pos).find((f) => f.code === "live_delegation")!.fix!.action).toBe("revoke");
  });
});

import { judgeNews } from "./advise.js";
describe("news judge", () => {
  it("rejects off topic closest match answers", () => {
    expect(judgeNews("kamino", 'Closest match only, not an exact answer. "There isn\'t an easy exploit for this PHP vulnerability"').credible).toBe(false);
  });
  it("flags an incident only when the protocol is named in the same sentence", () => {
    expect(judgeNews("kamino", "Kamino paused withdrawals after an oracle exploit on its JLP market.").keyword).toBe("paused");
    expect(judgeNews("kamino", "Kamino grew deposits this week. Another protocol was hacked.").keyword).toBeUndefined();
  });
  it("ignores a miner restating the query before listing unrelated headlines (live false alarms, Nov 26)", () => {
    const k = "Recent coverage of kamino Solana exploit hack pause depeg incident this week (3 articles) includes: 'Malware Alert: Hackers Exploit Claude Code Leak' and 'Bitcoin slips below $90K'.";
    expect(judgeNews("kamino", k).keyword).toBeUndefined();
    const m = "Recent coverage of marginfi Solana exploit hack this week includes: 'Huge $24 Million Hack on AFX Trade: Arbitrum Bridge Keys Compromised'.";
    expect(judgeNews("marginfi", m).keyword).toBeUndefined();
  });
  it("still flags a quoted headline that names the protocol, apostrophes included", () => {
    const t = "Recent coverage of kamino news includes: 'Kamino's JLP market paused after oracle exploit' and 'SOL rallies'.";
    const v = judgeNews("kamino", t);
    expect(v.keyword).toBe("paused");
    expect(v.headline).toContain("JLP market");
  });
});
