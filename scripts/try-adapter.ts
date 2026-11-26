// Dev helper: run one adapter against a wallet and print a compact summary.
import { makeContext } from "../src/engine/context.js";
const [id, wallet] = process.argv.slice(2);
const mods: Record<string, () => Promise<any>> = {
  orca: async () => (await import("../src/engine/adapters/orca.js")).orcaAdapter,
  raydium: async () => (await import("../src/engine/adapters/raydium.js")).raydiumAdapter,
  meteora: async () => (await import("../src/engine/adapters/meteora.js")).meteoraAdapter,
  drift: async () => (await import("../src/engine/adapters/drift.js")).driftAdapter,
  jup: async () => (await import("../src/engine/adapters/jupiterPerps.js")).jupiterPerpsAdapter,
};
const ad = await mods[id!]!();
const t = Date.now();
const r = await ad.read(wallet!, makeContext());
console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1).slice(0, 6000));
console.log("ms", Date.now() - t, "positions", r.positions.length, "usd", r.positions.reduce((s: number, p: any) => s + (p.usd ?? 0), 0));
