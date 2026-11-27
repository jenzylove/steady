// Spike: can a Kamino repay with collateral be signed now and still land after the price falls?
// 1. Build the rescue sized for a fall of 0%, 10% and 20%, simulate each now.
// 2. Build the same with a durable nonce lifetime (a placeholder nonce account) to check it still fits in one transaction.
// 3. With --age <file>, re-simulate saved rescues to see whether a route built earlier still lands.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { makeContext } from "../src/engine/context.js";
import { readPortfolio } from "../src/engine/portfolio.js";
import { kaminoRepay } from "../src/fix/kamino-sdk.js";
import { simulate } from "../src/fix/build.js";

const ctx = makeContext();
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : "rescue-spike.json";

if (process.argv.includes("--age")) {
  const saved = JSON.parse(readFileSync(out, "utf8")) as { builtAt: string; drop: number; tx: string }[];
  for (const s of saved) {
    const sim = await simulate(ctx, s.tx);
    console.log(new Date().toISOString(), `built ${s.builtAt} drop ${s.drop}`, sim.ok ? "LANDS" : `FAILS ${sim.err} ${sim.logsTail.slice(-2).join(" | ")}`);
  }
  process.exit(0);
}

const wallet = process.argv[2] ?? "44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS";
const { positions } = await readPortfolio(wallet, ctx);
const debt = positions.find((p) => p.protocol === "kamino" && p.kind === "borrow");
if (!debt) throw new Error("no Kamino debt in this wallet");
const amount = +(debt.amount * 0.25).toFixed(4);
console.log(`wallet ${wallet} debt ${debt.amount} ${debt.symbol}, rescue repays ${amount}`);
const saved: { builtAt: string; drop: number; tx: string }[] = [];
for (const drop of [0, 0.1, 0.2]) {
  const k = await kaminoRepay(ctx, wallet, debt.account!, debt.extra!.reserve as string, debt.mint!, debt.symbol ?? "debt", amount, positions, { atDropPct: drop, forceCollateral: true });
  if (!k.transaction) { console.log(`drop ${drop}: not built: ${k.unsupported}`); continue; }
  const sim = await simulate(ctx, k.transaction);
  console.log(`drop ${drop}: ${Buffer.from(k.transaction, "base64").length} bytes, ${sim.ok ? "simulates ok" : `fails ${sim.err}`}, ${sim.unitsConsumed} CU. ${k.summary}`);
  saved.push({ builtAt: new Date().toISOString(), drop, tx: k.transaction });
  // Same rescue with a durable nonce lifetime: only the size matters here, the placeholder nonce account does not exist.
  const n = await kaminoRepay(ctx, wallet, debt.account!, debt.extra!.reserve as string, debt.mint!, debt.symbol ?? "debt", amount, positions, {
    atDropPct: drop, forceCollateral: true,
    nonce: { account: "11111111111111111111111111111112", authority: wallet, value: "GfnhkAa2HmcHfGnBn8vrXXJPmVdjRp5QQ4PUZTjEi7d6" },
  }).catch((e) => ({ transaction: undefined, unsupported: String((e as Error).message) }));
  console.log(`  with durable nonce: ${n.transaction ? `${Buffer.from(n.transaction, "base64").length} bytes, fits` : `not built: ${n.unsupported}`}`);
}
writeFileSync(out, JSON.stringify(saved));
