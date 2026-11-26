import { makeContext } from "../src/engine/context.js";
import { meteoraAdapter } from "../src/engine/adapters/meteora.js";
const ctx = makeContext();
for (const w of ["9ZNSLCTLBkrCYfpBdnybhaWdmei6y1ysqXWpkb3dq2Hs", "3vM1zgks77KC9ow52NnsV7S1ohj1eTvcQdFFSp1SX3HG", "DsqdXGhdPyzJEteg7iuEjJzRq4ZuipH31MHpaXdB1sQ7", "5PBT1cPi7kMkSVabcgchChE5u1qyzBGDjzvyFrxNc6sj"]) {
  const r = await meteoraAdapter.read(w, ctx);
  const api: any = await (await fetch(`https://dlmm.datapi.meteora.ag/portfolio/open?user=${w}`)).json();
  const apiBal = api.pools.reduce((s: number, p: any) => s + Number(p.balances), 0);
  const apiFees = api.pools.reduce((s: number, p: any) => s + Number(p.unclaimedFees), 0);
  const ours = r.positions.reduce((s, p) => s + (p.usd ?? 0), 0);
  const fees = r.positions.reduce((s, p: any) => s + p.extra.tokenX.uncollectedFees * 0 , 0);
  console.log(w.slice(0, 8), "positions", r.positions.length, "ours", ours.toFixed(2), "api balances", apiBal.toFixed(2), "diff", (((ours - apiBal) / apiBal) * 100).toFixed(2) + "%", "api fees", apiFees.toFixed(2), "gaps", r.gaps.length, fees);
}
process.exit(0);
