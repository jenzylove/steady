// Check before signing: simulate a transaction on mainnet, describe what changes for the signer, and screen the parties.
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import type { AdapterContext } from "../engine/types.js";
import type { Evidence } from "../engine/advice/types.js";
import { ask } from "../telegraph/client.js";
import { toEvidence } from "../engine/advice/advise.js";

export interface BalanceChange { mint: string; symbol?: string | undefined; delta: number }
export interface PresignResult {
  verdict: "ok" | "caution" | "block";
  reasons: string[];
  simulation: { ok: boolean; err?: string | undefined; logsTail: string[] };
  signerChanges: BalanceChange[];
  ownerChanges: string[]; // token accounts whose owner or delegate would change to someone else
  programs: string[];
  recipients: string[];
  evidence: Evidence[];
}

const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: "Kamino Lend",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca",
  MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: "marginfi",
};

async function rpc<T>(ctx: AdapterContext, method: string, params: unknown[]): Promise<T> {
  const res = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** Simulate with the signer's token accounts returned, so balance changes can be computed. */
export async function presign(ctx: AdapterContext, txBase64: string, signer: string, opts: { telegraph?: boolean; history?: string[] } = {}): Promise<PresignResult> {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const programs = [...new Set(tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]).filter((x): x is string => !!x))];
  const reasons: string[] = [];

  // Signer's token accounts before.
  const before = await rpc<{ value: { pubkey: string; account: { data: { parsed: { info: any } } } }[] }>(ctx, "getTokenAccountsByOwner", [signer, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]);
  const before22 = await rpc<{ value: { pubkey: string; account: { data: { parsed: { info: any } } } }[] }>(ctx, "getTokenAccountsByOwner", [signer, { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }, { encoding: "jsonParsed" }]);
  // Only token accounts the transaction can touch can change; lookup table accounts are included when resolved.
  const lookupKeys: string[] = [];
  for (const l of tx.message.addressTableLookups) {
    const t = await rpc<{ value: { data: { parsed: { info: { addresses: string[] } } } } | null }>(ctx, "getAccountInfo", [l.accountKey.toBase58(), { encoding: "jsonParsed" }]);
    const addrs = t.value?.data?.parsed?.info?.addresses ?? [];
    for (const i of [...l.writableIndexes]) if (addrs[i]) lookupKeys.push(addrs[i]!);
  }
  const touched = new Set([...keys, ...lookupKeys]);
  const accts = [...before.value, ...before22.value].filter((a) => touched.has(a.pubkey)).slice(0, 24);
  const solBefore = (await rpc<{ value: number }>(ctx, "getBalance", [signer])).value;

  const sim = await rpc<{ value: { err: unknown; logs: string[] | null; accounts: ({ data: [string, string] | any; lamports: number } | null)[] | null } }>(ctx, "simulateTransaction", [
    txBase64,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "jsonParsed", addresses: [signer, ...accts.map((a) => a.pubkey)] } },
  ]);
  const ok = sim.value.err === null;
  const signerChanges: BalanceChange[] = [];
  const ownerChanges: string[] = [];
  const after = sim.value.accounts ?? [];
  if (after[0]) {
    const d = (after[0].lamports - solBefore) / 1e9;
    if (Math.abs(d) > 1e-9) signerChanges.push({ mint: "SOL", symbol: "SOL", delta: d });
  }
  accts.forEach((a, i) => {
    const post = after[i + 1] as any;
    const pre = a.account.data.parsed.info;
    const preAmt = Number(pre.tokenAmount.uiAmount ?? 0);
    if (!post) { if (preAmt > 0) signerChanges.push({ mint: pre.mint, delta: -preAmt }); return; }
    const info = post.data?.parsed?.info;
    if (!info) return;
    const d = Number(info.tokenAmount?.uiAmount ?? 0) - preAmt;
    if (Math.abs(d) > 1e-12) signerChanges.push({ mint: pre.mint, delta: d });
    if (info.owner && info.owner !== signer) ownerChanges.push(`${a.pubkey} owner becomes ${info.owner}`);
    if (info.delegate && info.delegate !== pre.delegate) ownerChanges.push(`${a.pubkey} gives ${info.delegate} the right to move ${info.delegatedAmount?.uiAmountString ?? "tokens"}`);
  });

  // Recipients: non program, non signer keys that are writable.
  const header = tx.message.header;
  const writableSigned = header.numRequiredSignatures - header.numReadonlySignedAccounts;
  const writableUnsigned = keys.length - header.numRequiredSignatures - header.numReadonlyUnsignedAccounts;
  const writable = [...keys.slice(0, writableSigned), ...keys.slice(header.numRequiredSignatures, header.numRequiredSignatures + writableUnsigned)];
  const recipients = writable.filter((k) => k !== signer && !programs.includes(k) && !accts.some((a) => a.pubkey === k)).slice(0, 8);

  if (!ok) reasons.push(`The transaction would fail: ${JSON.stringify(sim.value.err)}`);
  if (ownerChanges.length) reasons.push(`It hands control of your tokens to someone else: ${ownerChanges.join("; ")}`);
  const unknown = programs.filter((p) => !KNOWN_PROGRAMS[p]);
  if (unknown.length) reasons.push(`It calls ${unknown.length} program(s) Steady does not recognise: ${unknown.map((p) => p.slice(0, 4) + "…" + p.slice(-4)).join(", ")}`);

  // Address poisoning: a recipient that looks like one from the user's history but is not it.
  for (const r of recipients) {
    const twin = (opts.history ?? []).find((h) => h !== r && h.slice(0, 4) === r.slice(0, 4) && h.slice(-4) === r.slice(-4));
    if (twin) reasons.push(`Recipient ${r.slice(0, 6)}…${r.slice(-6)} imitates ${twin.slice(0, 6)}…${twin.slice(-6)} from your history (address poisoning)`);
  }

  const evidence: Evidence[] = [];
  if (opts.telegraph !== false) {
    await Promise.all(recipients.slice(0, 3).map(async (r) => {
      const a = await ask("SANCTIONS_SCREENING_MATCH_GENERAL", { name: r });
      const matched = a.result?.matched === true;
      evidence.push(toEvidence(a, a.ok ? `sanctions: ${matched ? "MATCHED" : "no match"} for ${r.slice(0, 6)}…` : a.error ?? "no answer"));
      if (matched) reasons.push(`Recipient ${r.slice(0, 6)}… matches a sanctions list`);
    }));
  }

  const block = !ok || ownerChanges.length > 0 || reasons.some((x) => /sanctions|poisoning/.test(x));
  const verdict = block ? "block" : reasons.length ? "caution" : "ok";
  return { verdict, reasons, simulation: { ok, err: ok ? undefined : JSON.stringify(sim.value.err), logsTail: (sim.value.logs ?? []).slice(-6) }, signerChanges, ownerChanges, programs: programs.map((p) => KNOWN_PROGRAMS[p] ?? p), recipients, evidence };
}

export function isAddress(s: string): boolean { try { new PublicKey(s); return true; } catch { return false; } }
