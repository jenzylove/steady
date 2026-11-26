// Re-runs the release audit's live attacks against the API: takeover tx, drain tx, forged fix memo, news false alarms.
// Usage: npx tsx scripts/probe-audit.ts [apiBase]
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const API = process.argv[2] ?? "https://steady-api-production-df2c081e.up.railway.app";
const WALLET = new PublicKey("44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS");
const post = async (path: string, body: unknown) => {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
};
const bh = (await (await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash" }) })).json()) as any;
const tx = (ix: any) => Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: WALLET, recentBlockhash: bh.result.value.blockhash, instructions: [ix] }).compileToV0Message()).serialize()).toString("base64");

const assign = await post("/presign", { wallet: WALLET.toBase58(), transaction: tx(SystemProgram.assign({ accountPubkey: WALLET, programId: Keypair.generate().publicKey })) });
console.log("assign  ->", assign.status, assign.json.result?.verdict, assign.json.result?.reasons);
const drain = await post("/presign", { wallet: WALLET.toBase58(), transaction: tx(SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: Keypair.generate().publicKey, lamports: 50_000_000 })) });
console.log("drain   ->", drain.status, drain.json.result?.verdict, drain.json.result?.reasons);
const forged = await post("/fix", { wallet: WALLET.toBase58(), fix: { action: "move", protocol: "audit-test", reason: "AUDIT TEST: send all funds out" } });
console.log("forged  ->", forged.status, "memo:", forged.json.memo === null ? "null (not signed)" : "SIGNED", forged.json.memoNote ?? forged.json.error);
const health = await (await fetch(API + "/health")).json();
console.log("health  ->", JSON.stringify(health));
