// Steady Guard: the owner signs one rescue for a Kamino loan in advance (durable nonce, so it does not expire), and
// Steady sends that exact signed transaction when the loan's health falls to the owner's line. Steady never holds a key:
// it can only send the bytes the owner signed, and those bytes only repay the owner's own debt from the loan's own
// collateral. Closing the nonce account (one signature) cancels the rescue for good.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import nacl from "tweetnacl";
import {
  NONCE_ACCOUNT_LENGTH, NonceAccount, PublicKey, SystemProgram, Transaction, VersionedTransaction,
} from "@solana/web3.js";
import type { AdapterContext, LoanAccount, Position } from "../engine/types.js";
import { healthFactor } from "../engine/risk/health.js";
import { kaminoAdapter } from "../engine/adapters/kamino.js";
import { kaminoRepay } from "../fix/kamino-sdk.js";

export const GUARD_SEED = "steady-guard";
export const GUARD_FILE = process.env.GUARD_PATH ?? resolve(process.cwd(), "data", "guards.json");
/** Health Steady aims to restore when the rescue fires. */
export const TARGET_HEALTH = 1.35;
/** Extra fall the sale is sized for beyond the line, so a price gap between checks still leaves enough. */
export const GAP_BUFFER = 0.04;

export type GuardStatus = "prepared" | "armed" | "fired" | "failed" | "stale" | "cancelled";
export interface GuardEvent { at: string; kind: "armed" | "fired" | "failed" | "stale" | "cancelled" | "early"; note: string; signature?: string | undefined }
export interface Guard {
  wallet: string;
  obligation: string;
  line: number;
  repay: { amount: number; symbol: string; mint: string; reserve: string };
  collateral: { symbol: string; mint: string };
  atDropPct: number;
  nonceAccount: string;
  nonceValue: string;
  preparedMessage: string; // sha256 of the exact message the owner is asked to sign
  summary: string;
  signedTx?: string | undefined;
  status: GuardStatus;
  createdAt: string;
  lastHealth?: number | undefined;
  lastCheckedAt?: string | undefined;
  lastSimOk?: boolean | undefined;
  lastSimAt?: string | undefined;
  /** Last early fire check: chain health, health at agreed Telegraph market prices, and the miners that answered. */
  lastEarly?: unknown;
  firedSignature?: string | undefined;
  events: GuardEvent[];
}

// ---------- store ----------
export function loadGuards(file = GUARD_FILE): Guard[] {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Guard[]) : []; } catch { return []; }
}
export function saveGuards(gs: Guard[], file = GUARD_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(gs, null, 1));
  renameSync(`${file}.tmp`, file);
}
const key = (wallet: string, obligation: string) => `${wallet}:${obligation}`;
export function findGuard(gs: Guard[], wallet: string, obligation?: string): Guard | undefined {
  return gs.filter((g) => g.wallet === wallet && (!obligation || g.obligation === obligation) && g.status !== "cancelled").at(-1);
}

// ---------- chain helpers ----------
async function rpc<T>(ctx: AdapterContext, method: string, params: unknown[]): Promise<T> {
  const r = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

export async function nonceAddress(wallet: string): Promise<string> {
  return (await PublicKey.createWithSeed(new PublicKey(wallet), GUARD_SEED, SystemProgram.programId)).toBase58();
}

/** The nonce's current value, or null when the account does not exist yet. */
export async function readNonce(ctx: AdapterContext, account: string): Promise<{ value: string; authority: string } | null> {
  const r = await rpc<{ value: { data: [string, string]; owner: string } | null }>(ctx, "getAccountInfo", [account, { encoding: "base64", commitment: "confirmed" }]);
  if (!r.value) return null;
  const n = NonceAccount.fromAccountData(Buffer.from(r.value.data[0], "base64"));
  return { value: n.nonce, authority: n.authorizedPubkey.toBase58() };
}

/** One transaction the owner signs and sends to create the guard's nonce account (about 0.0015 SOL rent, returned on cancel). */
export async function nonceCreateTx(ctx: AdapterContext, wallet: string): Promise<string> {
  const owner = new PublicKey(wallet);
  const noncePubkey = new PublicKey(await nonceAddress(wallet));
  const lamports = await rpc<number>(ctx, "getMinimumBalanceForRentExemption", [NONCE_ACCOUNT_LENGTH]);
  const { value } = await rpc<{ value: { blockhash: string } }>(ctx, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: owner, recentBlockhash: value.blockhash }).add(
    SystemProgram.createAccountWithSeed({ fromPubkey: owner, newAccountPubkey: noncePubkey, basePubkey: owner, seed: GUARD_SEED, lamports, space: NONCE_ACCOUNT_LENGTH, programId: SystemProgram.programId }),
    SystemProgram.nonceInitialize({ noncePubkey, authorizedPubkey: owner }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** Cancel: withdraw the whole nonce balance back to the owner, which closes the account and kills the signed rescue forever. */
export async function nonceCloseTx(ctx: AdapterContext, wallet: string): Promise<string> {
  const owner = new PublicKey(wallet);
  const noncePubkey = new PublicKey(await nonceAddress(wallet));
  const bal = await rpc<{ value: number }>(ctx, "getBalance", [noncePubkey.toBase58(), { commitment: "confirmed" }]);
  const { value } = await rpc<{ value: { blockhash: string } }>(ctx, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: owner, recentBlockhash: value.blockhash }).add(
    SystemProgram.nonceWithdraw({ noncePubkey, authorizedPubkey: owner, toPubkey: owner, lamports: bal.value }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

// ---------- sizing ----------
/**
 * How much debt to repay when the loan sits exactly at `line`, so health returns to `target`.
 * At the line, liquidation weighted collateral equals line x weighted debt. Selling collateral worth V to repay V of debt
 * removes V x lt from the top and V x bf from the bottom: (line*D - V*lt) / (D - V*bf) = target.
 */
export function rescueSize(loan: LoanAccount, line: number, target = TARGET_HEALTH) {
  const coll = [...loan.collaterals].sort((a, b) => b.usd - a.usd)[0];
  const debt = [...loan.borrows].sort((a, b) => b.usd - a.usd)[0];
  if (!coll || !debt) throw new Error("loan needs collateral and debt");
  const D = loan.borrows.reduce((s, b) => s + b.usd * (b.factor || 1), 0);
  const lt = coll.factor, bf = debt.factor || 1;
  let usd = (D * (target - line)) / (target * bf - lt);
  usd = Math.min(Math.max(usd, 0), debt.usd * 0.9);
  const amount = +(usd / (debt.usd / debt.amount)).toFixed(6);
  const h = healthFactor(loan);
  // How far the collateral must fall (debt fixed) for health to reach the line, plus a buffer for gaps between checks.
  const atDropPct = Math.min(Math.max(1 - line / h, 0) + GAP_BUFFER, 0.5);
  return { coll, debt, amount, usd, atDropPct, health: h };
}

export const messageHash = (txB64: string) =>
  createHash("sha256").update(VersionedTransaction.deserialize(Buffer.from(txB64, "base64")).message.serialize()).digest("hex");

/** True when `signedB64` is exactly the prepared message and carries a valid signature from `wallet`. */
export function checkSigned(signedB64: string, wallet: string, preparedHash: string): { ok: boolean; reason?: string } {
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(Buffer.from(signedB64, "base64")); } catch { return { ok: false, reason: "not a Solana transaction" }; }
  const bytes = tx.message.serialize();
  if (createHash("sha256").update(bytes).digest("hex") !== preparedHash) return { ok: false, reason: "this is not the rescue Steady prepared (the message changed)" };
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58());
  const i = signers.indexOf(wallet);
  if (i < 0) return { ok: false, reason: "the wallet is not a signer" };
  const sig = tx.signatures[i];
  if (!sig || !nacl.sign.detached.verify(bytes, sig, new PublicKey(wallet).toBytes())) return { ok: false, reason: "the wallet's signature does not verify" };
  return { ok: true };
}

// ---------- prepare / arm ----------
export async function readKaminoLoan(ctx: AdapterContext, wallet: string, obligation: string): Promise<{ loan: LoanAccount | undefined; positions: Position[] }> {
  const r = await kaminoAdapter.read(wallet, ctx);
  return { loan: r.loans.find((l) => l.account === obligation), positions: r.positions };
}

export type PrepareResult =
  | { step: "create-nonce"; transaction: string; nonceAccount: string; note: string }
  | { step: "sign-rescue"; transaction: string; guard: Guard };

export async function prepare(ctx: AdapterContext, wallet: string, obligation: string, line: number, gs: Guard[]): Promise<PrepareResult> {
  if (!(line > 1.0 && line < 2)) throw new Error("line must be a health between 1.0 and 2");
  const nonceAccount = await nonceAddress(wallet);
  const nonce = await readNonce(ctx, nonceAccount);
  if (!nonce) return { step: "create-nonce", transaction: await nonceCreateTx(ctx, wallet), nonceAccount, note: "Creates the guard's nonce account (about 0.0015 SOL rent, returned when you cancel). Sign and send this first." };
  if (nonce.authority !== wallet) throw new Error("the guard nonce account is controlled by another key");
  const { loan, positions } = await readKaminoLoan(ctx, wallet, obligation);
  if (!loan) throw new Error("no Kamino loan with that obligation in this wallet");
  const s = rescueSize(loan, line);
  if (s.health <= line) throw new Error(`health is already ${s.health.toFixed(3)}, at or below the line; use the fix now instead`);
  const debtPos = positions.find((p) => p.account === obligation && p.kind === "borrow" && p.mint === s.debt.mint);
  if (!debtPos?.extra?.reserve) throw new Error("debt reserve not found in this read");
  const k = await kaminoRepay(ctx, wallet, obligation, debtPos.extra.reserve as string, s.debt.mint, s.debt.symbol, s.amount, positions, {
    atDropPct: s.atDropPct, forceCollateral: true, nonce: { account: nonceAccount, authority: wallet, value: nonce.value },
  });
  if (!k.transaction) throw new Error(`the rescue could not be built: ${k.unsupported ?? "unknown"}`);
  const guard: Guard = {
    wallet, obligation, line,
    repay: { amount: s.amount, symbol: s.debt.symbol, mint: s.debt.mint, reserve: debtPos.extra.reserve as string },
    collateral: { symbol: s.coll.symbol, mint: s.coll.mint },
    atDropPct: s.atDropPct, nonceAccount, nonceValue: nonce.value, preparedMessage: messageHash(k.transaction),
    summary: `When health falls to ${line}, Steady sends this rescue: it sells ${s.coll.symbol} from the loan to repay ${+s.amount.toFixed(4)} ${s.debt.symbol}, sized to cover a ${(s.atDropPct * 100).toFixed(1)}% fall in ${s.coll.symbol}, bringing health back near ${TARGET_HEALTH}.`,
    status: "prepared", createdAt: new Date().toISOString(), lastHealth: s.health, events: [],
  };
  const i = gs.findIndex((g) => key(g.wallet, g.obligation) === key(wallet, obligation) && g.status !== "fired" && g.status !== "cancelled");
  if (i >= 0) gs.splice(i, 1);
  gs.push(guard);
  return { step: "sign-rescue", transaction: k.transaction, guard };
}

export async function simulateSigned(ctx: AdapterContext, signedB64: string): Promise<{ ok: boolean; err?: string; logs: string[] }> {
  const r = await rpc<{ value: { err: unknown; logs: string[] | null } }>(ctx, "simulateTransaction", [signedB64, { encoding: "base64", sigVerify: true, replaceRecentBlockhash: false, commitment: "confirmed" }]);
  return { ok: r.value.err === null, ...(r.value.err === null ? {} : { err: JSON.stringify(r.value.err) }), logs: (r.value.logs ?? []).slice(-4) };
}

export async function arm(ctx: AdapterContext, g: Guard, signedB64: string): Promise<{ ok: boolean; reason?: string }> {
  const c = checkSigned(signedB64, g.wallet, g.preparedMessage);
  if (!c.ok) return c;
  // The signed rescue must land right now (the collateral sale is oversized at today's price, which is fine).
  const sim = await simulateSigned(ctx, signedB64);
  if (!sim.ok) return { ok: false, reason: `the signed rescue does not simulate: ${sim.err}` };
  g.signedTx = signedB64; g.status = "armed"; g.lastSimOk = true;
  g.events.push({ at: new Date().toISOString(), kind: "armed", note: `armed at health ${g.lastHealth?.toFixed(3)}, line ${g.line}` });
  return { ok: true };
}

// ---------- watch ----------
export interface FireDeps {
  send: (tx: string) => Promise<string>;
  confirm: (sig: string) => Promise<boolean>;
  /** Overridable for tests: the loan health now, or null when the loan is closed. */
  health?: (g: Guard) => Promise<number | null>;
  simulate?: (tx: string) => Promise<{ ok: boolean; err?: string }>;
}

export function rpcFireDeps(ctx: AdapterContext): FireDeps {
  return {
    send: (tx) => rpc<string>(ctx, "sendTransaction", [tx, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 }]),
    confirm: async (sig) => {
      for (let i = 0; i < 30; i++) {
        const r = await rpc<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>(ctx, "getSignatureStatuses", [[sig]]);
        const s = r.value[0];
        if (s?.err) return false;
        if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return true;
        await new Promise((res) => setTimeout(res, 2000));
      }
      return false;
    },
  };
}

/**
 * One pass over armed guards: read health, fire the signed rescue at or below the line (or when `early` says a
 * credible outside signal justifies firing now), and mark a rescue stale when it no longer simulates.
 */
export async function tick(ctx: AdapterContext, gs: Guard[], deps: FireDeps, early: (g: Guard, health: number) => Promise<string | null> = async () => null, simEveryMs = 30 * 60_000): Promise<Guard[]> {
  const changed: Guard[] = [];
  const sim1 = deps.simulate ?? ((tx: string) => simulateSigned(ctx, tx));
  for (const g of gs.filter((x) => x.status === "armed" && x.signedTx)) {
    const now = new Date();
    try {
      const h0 = deps.health ? await deps.health(g) : await readKaminoLoan(ctx, g.wallet, g.obligation).then(({ loan }) => (loan && loan.borrows.length ? healthFactor(loan) : null));
      if (h0 === null) { g.status = "cancelled"; g.events.push({ at: now.toISOString(), kind: "cancelled", note: "the loan is closed or has no debt" }); changed.push(g); continue; }
      const h = h0;
      g.lastHealth = h; g.lastCheckedAt = now.toISOString();
      const earlyReason = h > g.line ? await early(g, h) : null;
      if (h <= g.line || earlyReason) {
        const sim = await sim1(g.signedTx!);
        if (!sim.ok) { g.status = "stale"; g.lastSimOk = false; g.events.push({ at: now.toISOString(), kind: "stale", note: `health ${h.toFixed(3)} hit the line but the signed rescue no longer lands (${sim.err}); use the fix now` }); changed.push(g); continue; }
        if (earlyReason) g.events.push({ at: now.toISOString(), kind: "early", note: earlyReason });
        const sig = await deps.send(g.signedTx!);
        const ok = await deps.confirm(sig);
        g.status = ok ? "fired" : "failed"; g.firedSignature = sig;
        g.events.push({ at: new Date().toISOString(), kind: ok ? "fired" : "failed", note: `${earlyReason ? "fired early" : `health ${h.toFixed(3)} reached the line ${g.line}`}; rescue ${ok ? "confirmed" : "did not confirm"}`, signature: sig });
        changed.push(g); continue;
      }
      if (!g.lastSimAt || now.getTime() - Date.parse(g.lastSimAt) > simEveryMs) {
        const sim = await sim1(g.signedTx!);
        g.lastSimAt = now.toISOString(); g.lastSimOk = sim.ok;
        if (!sim.ok) { g.status = "stale"; g.events.push({ at: now.toISOString(), kind: "stale", note: `the signed rescue stopped landing (${sim.err}); re-arm to refresh it` }); }
        changed.push(g);
      }
    } catch (e) {
      g.lastCheckedAt = now.toISOString();
    }
  }
  return changed;
}
