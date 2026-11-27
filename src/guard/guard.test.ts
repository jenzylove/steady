import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { checkSigned, messageHash, rescueSize, tick, type Guard } from "./guard.js";
import type { AdapterContext, LoanAccount } from "../engine/types.js";

const loan = (collUsd: number, debtUsd: number, lt = 0.85): LoanAccount => ({
  protocol: "kamino", account: "OB", sources: [],
  collaterals: [{ mint: "C", symbol: "JLP", amount: collUsd / 4, usd: collUsd, factor: lt }],
  borrows: [{ mint: "D", symbol: "USDT", amount: debtUsd, usd: debtUsd, factor: 1 }],
});

describe("rescue sizing", () => {
  it("repays enough at the line to restore the target health", () => {
    const l = loan(200, 100); // health 1.7
    const s = rescueSize(l, 1.15, 1.35);
    // At the line, weighted collateral is 1.15 x 100. Selling V to repay V gives (115 - 0.85V) / (100 - V) = 1.35.
    expect((115 - 0.85 * s.usd) / (100 - s.usd)).toBeCloseTo(1.35, 6);
    expect(s.amount).toBeCloseTo(s.usd, 6);
  });
  it("sizes the sale for the fall to the line plus a buffer", () => {
    const s = rescueSize(loan(200, 100), 1.15);
    expect(s.atDropPct).toBeCloseTo(1 - 1.15 / 1.7 + 0.04, 6);
  });
  it("never repays more than 90% of the debt", () => {
    expect(rescueSize(loan(120, 100, 0.95), 1.05, 2).usd).toBeLessThanOrEqual(90);
  });
});

function signedTransfer(kp: Keypair, lamports = 1) {
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: "GfnhkAa2HmcHfGnBn8vrXXJPmVdjRp5QQ4PUZTjEi7d6", instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports })] }).compileToV0Message();
  const unsigned = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
  const tx = new VersionedTransaction(msg); tx.sign([kp]);
  return { unsigned, signed: Buffer.from(tx.serialize()).toString("base64") };
}

describe("arming checks the exact signed bytes", () => {
  const kp = Keypair.generate();
  const { unsigned, signed } = signedTransfer(kp);
  it("accepts the prepared message signed by the wallet", () => {
    expect(checkSigned(signed, kp.publicKey.toBase58(), messageHash(unsigned))).toEqual({ ok: true });
  });
  it("rejects a different message", () => {
    const other = signedTransfer(kp, 2).signed;
    expect(checkSigned(other, kp.publicKey.toBase58(), messageHash(unsigned)).ok).toBe(false);
  });
  it("rejects a signature from another key", () => {
    const stranger = Keypair.generate();
    expect(checkSigned(signed, stranger.publicKey.toBase58(), messageHash(unsigned)).ok).toBe(false);
  });
  it("rejects a forged signature", () => {
    const tx = VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
    tx.signatures[0] = new Uint8Array(64).fill(7);
    expect(checkSigned(Buffer.from(tx.serialize()).toString("base64"), kp.publicKey.toBase58(), messageHash(unsigned)).ok).toBe(false);
  });
});

const ctx = {} as AdapterContext;
const armed = (): Guard => ({
  wallet: new PublicKey(new Uint8Array(32).fill(1)).toBase58(), obligation: "OB", line: 1.15,
  repay: { amount: 10, symbol: "USDT", mint: "D", reserve: "R" }, collateral: { symbol: "JLP", mint: "C" },
  atDropPct: 0.2, nonceAccount: "N", nonceValue: "V", preparedMessage: "h", summary: "", signedTx: "AAA", status: "armed",
  createdAt: new Date().toISOString(), events: [], lastSimAt: new Date().toISOString(),
});

describe("the watcher", () => {
  it("stays quiet above the line", async () => {
    const g = armed(); const sent: string[] = [];
    await tick(ctx, [g], { send: async (t) => { sent.push(t); return "sig"; }, confirm: async () => true, health: async () => 1.3, simulate: async () => ({ ok: true }) });
    expect(sent).toEqual([]); expect(g.status).toBe("armed"); expect(g.lastHealth).toBe(1.3);
  });
  it("sends the signed rescue at the line and records the signature", async () => {
    const g = armed(); const sent: string[] = [];
    await tick(ctx, [g], { send: async (t) => { sent.push(t); return "SIG1"; }, confirm: async () => true, health: async () => 1.14, simulate: async () => ({ ok: true }) });
    expect(sent).toEqual(["AAA"]); expect(g.status).toBe("fired"); expect(g.firedSignature).toBe("SIG1");
  });
  it("never sends a rescue that no longer simulates; marks it stale instead", async () => {
    const g = armed(); const sent: string[] = [];
    await tick(ctx, [g], { send: async (t) => { sent.push(t); return "x"; }, confirm: async () => true, health: async () => 1.1, simulate: async () => ({ ok: false, err: "slippage" }) });
    expect(sent).toEqual([]); expect(g.status).toBe("stale");
  });
  it("fires early only when the outside signal says so, and records why", async () => {
    const g = armed(); const sent: string[] = [];
    await tick(ctx, [g], { send: async (t) => { sent.push(t); return "S"; }, confirm: async () => true, health: async () => 1.25, simulate: async () => ({ ok: true }) }, async () => "USDT trades at $0.96 on Jupiter while the oracle says $1.00");
    expect(sent).toEqual(["AAA"]); expect(g.events.some((e) => e.kind === "early")).toBe(true);
  });
  it("stands down when the loan is closed", async () => {
    const g = armed();
    await tick(ctx, [g], { send: async () => "x", confirm: async () => true, health: async () => null });
    expect(g.status).toBe("cancelled");
  });
});
