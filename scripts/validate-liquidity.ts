// Compares poolLiquidityUsd with each DEX's own public TVL on real pools. Run: npx tsx scripts/validate-liquidity.ts
import { makeContext } from "../src/engine/context.js";
import { poolLiquidity } from "../src/engine/pools/liquidity.js";
const ctx = makeContext();
const j = async (u: string) => (await fetch(u)).json() as Promise<any>;
const rows: { dex: string; pool: string; theirs: number }[] = [];
const orca = await j("https://api.orca.so/v2/solana/pools?limit=4&sortBy=tvl&sortDirection=desc&minTvl=1000000");
for (const p of orca.data) rows.push({ dex: "orca", pool: p.address, theirs: Number(p.tvlUsdc) });
rows.push({ dex: "orca", pool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", theirs: Number((await j("https://api.orca.so/v2/solana/pools/Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE")).data.tvlUsdc) });
for (const type of ["Concentrated", "Standard", "Standard"]) {
  const l = await j(`https://api-v3.raydium.io/pools/info/list?poolType=${type.toLowerCase()}&poolSortField=liquidity&sortType=desc&pageSize=8&page=1`);
  const arr = l.data.data.filter((p: any) => rows.every((r) => r.pool !== p.id));
  const pick = type === "Standard" && rows.filter((r) => r.dex === "raydium").length >= 2 ? arr.find((p: any) => p.programId.startsWith("CPMM")) : arr[0];
  if (pick) rows.push({ dex: "raydium", pool: pick.id, theirs: pick.tvl });
}
const cp = await j("https://api-v3.raydium.io/pools/info/list?poolType=standard&poolSortField=liquidity&sortType=desc&pageSize=20&page=1");
const cpmm = cp.data.data.find((p: any) => p.programId === "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
if (cpmm && rows.every((r) => r.pool !== cpmm.id)) rows.push({ dex: "raydium", pool: cpmm.id, theirs: cpmm.tvl });
const met = await j("https://dlmm.datapi.meteora.ag/pools?page_size=4&sort_by=tvl:desc");
for (const p of (met.data ?? met.pools ?? []).slice(0, 3)) rows.push({ dex: "meteora", pool: p.address, theirs: Number(p.tvl) });
let n = 0;
for (const r of rows.filter((x) => x.dex === (process.argv[2] ?? x.dex)).slice(0, 12)) {
  await new Promise((x) => setTimeout(x, 1500));
  try {
    const o = await poolLiquidity(ctx, r.pool);
    console.log(`${r.dex.padEnd(8)} ${o.dex.padEnd(15)} ${(o.tokenA.symbol + "/" + o.tokenB.symbol).padEnd(14)} ${r.pool.slice(0, 8)} ours ${o.usd?.toFixed(0)} theirs ${r.theirs.toFixed(0)} diff ${o.usd ? (((o.usd - r.theirs) / r.theirs) * 100).toFixed(2) + "%" : "n/a"} ${o.gaps.join(";")}`);
    n++;
  } catch (e) { console.log(r.dex, r.pool, "ERR", String(e).replace(/api-key=[^&\s]+/g, "")); }
}
console.log("validated", n);
