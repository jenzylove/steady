// Read every adapter for a wallet in parallel; never throws, failures become gaps.
import { scrub } from "./adapters/util.js";
import type { Adapter, AdapterContext, AdapterResult } from "./types.js";
import { walletAdapter } from "./adapters/wallet.js";
import { stakeAdapter } from "./adapters/stake.js";
import { kaminoAdapter } from "./adapters/kamino.js";
import { marginfiAdapter } from "./adapters/marginfi.js";
import { saveAdapter } from "./adapters/save.js";
import { orcaAdapter } from "./adapters/orca.js";
import { raydiumAdapter } from "./adapters/raydium.js";
import { meteoraAdapter } from "./adapters/meteora.js";
import { driftAdapter } from "./adapters/drift.js";
import { jupiterPerpsAdapter } from "./adapters/jupiterPerps.js";

export const ALL_ADAPTERS: Adapter[] = [
  walletAdapter, stakeAdapter, kaminoAdapter, marginfiAdapter, saveAdapter,
  orcaAdapter, raydiumAdapter, meteoraAdapter, driftAdapter, jupiterPerpsAdapter,
];

export async function readPortfolio(wallet: string, ctx: AdapterContext, adapters: Adapter[] = ALL_ADAPTERS): Promise<AdapterResult> {
  const out: AdapterResult = { positions: [], loans: [], gaps: [] };
  const res = await Promise.allSettled(adapters.map((a) => a.read(wallet, ctx)));
  res.forEach((r, i) => {
    if (r.status === "fulfilled") { out.positions.push(...r.value.positions); out.loans.push(...r.value.loans); out.gaps.push(...r.value.gaps); }
    else out.gaps.push(`${adapters[i]?.id}: ${scrub(String(r.reason)).slice(0, 200)}`);
  });
  return out;
}
