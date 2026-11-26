// Usage: tsx scripts/compare-lending.ts <kamino|marginfi|save> <wallet> [wallet...]
// Reads each wallet with the adapter and compares our healthFactor to the protocol reported one.
import { makeContext } from "../src/engine/context.js";
import { healthFactor } from "../src/engine/risk/health.js";
import { saveAdapter } from "../src/engine/adapters/save.js";
import type { Adapter } from "../src/engine/types.js";

async function load(id: string): Promise<Adapter> {
  if (id === "save") return saveAdapter;
  if (id === "kamino") return (await import("../src/engine/adapters/kamino.js")).kaminoAdapter;
  if (id === "marginfi") return (await import("../src/engine/adapters/marginfi.js")).marginfiAdapter;
  throw new Error("unknown adapter " + id);
}

const [id, ...wallets] = process.argv.slice(2);
const adapter = await load(id!);
const ctx = makeContext();
for (const w of wallets) {
  const r = await adapter.read(w, ctx);
  for (const l of r.loans) {
    const ours = healthFactor(l);
    const rep = l.protocolReported?.healthFactor;
    const diff = rep ? ((ours / rep - 1) * 100).toFixed(2) + "%" : "n/a";
    const coll = l.collaterals.map((c) => `${c.symbol}:${c.usd.toFixed(0)}@${c.factor}`).join(",");
    const bor = l.borrows.map((c) => `${c.symbol}:${c.usd.toFixed(0)}@${c.factor}`).join(",");
    console.log(`${w} ${l.account} ours=${ours.toFixed(4)} protocol=${rep?.toFixed(4)} diff=${diff} | C ${coll} | B ${bor}`);
  }
  if (r.gaps.length) console.log("  gaps:", r.gaps);
}
