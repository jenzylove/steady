// Public timestamps for the forward ledger. Each batch of calls is hashed into one root (sha256 of the sorted original
// memo digests) and written as data in an Ethereum Sepolia transaction, so anyone can see the calls existed before they settled.
import { createHash } from "node:crypto";
import { createWalletClient, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { Ledger } from "./store.js";

export interface Anchor { batch: string; root: string; count: number; txHash: string; chain: "ethereum-sepolia"; at: string }

export function batchRoot(digests: string[]): string {
  return createHash("sha256").update([...digests].sort().join("\n")).digest("hex");
}

/** The anchor payload, readable as text in any explorer's input data view. */
export function anchorData(batch: string, root: string): string {
  return `steady ledger v1 batch ${batch} root ${root}`;
}

/** Batches by the minute their calls were made, with each call's ORIGINAL digest (before any later signed update). */
export function batches(ledger: Ledger): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of ledger.load()) {
    const key = e.firstMemo.body.madeAt.slice(0, 16);
    out.set(key, [...(out.get(key) ?? []), e.firstMemo.digest]);
  }
  return out;
}

export async function sendAnchor(batch: string, root: string): Promise<string> {
  const key = process.env.TELEGRAPH_PAYER_KEY;
  if (!key) throw new Error("TELEGRAPH_PAYER_KEY is not set");
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
  return wallet.sendTransaction({ to: account.address, value: 0n, data: toHex(anchorData(batch, root)) });
}

/** Anchor every batch that has no anchor yet. Returns the anchors written. */
export async function anchorPending(ledger: Ledger, send = sendAnchor, now = () => new Date()): Promise<Anchor[]> {
  const done = new Set(ledger.anchors().map((a) => `${a.batch} ${a.root}`));
  const written: Anchor[] = [];
  for (const [batch, digests] of batches(ledger)) {
    const root = batchRoot(digests);
    if (done.has(`${batch} ${root}`)) continue;
    const txHash = await send(batch, root);
    const a: Anchor = { batch, root, count: digests.length, txHash, chain: "ethereum-sepolia", at: now().toISOString() };
    ledger.writeAnchor(a);
    written.push(a);
  }
  return written;
}
