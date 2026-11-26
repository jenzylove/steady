// Records real responses for the wallet adapters into src/engine/__fixtures__/<name>.json.
// Usage: npx tsx scripts/record-wallet.ts
import { writeFileSync } from "node:fs";
import { makeContext } from "../src/engine/context.js";
import { walletAdapter } from "../src/engine/adapters/wallet.js";
import { stakeAdapter } from "../src/engine/adapters/stake.js";
import { recentActivity } from "../src/engine/adapters/history.js";
import { recordingFetch, type Recorded } from "../src/engine/__fixtures__/replay.js";

export const FIXTURE_WALLETS: Record<string, string> = {
  // 31 tokens incl. mSOL, 3 live token delegations
  "wallet-tokens": "J6DV46TYWk359ym6Uks5FT7ehfnWhcjVrHYowCbYLfXR",
  // two native stake accounts (staker differs from withdrawer on the first lookup path)
  "wallet-stake": "5ECz5NM8Y7m6avBxd5bEh4hNzeZfBk3wg3BxGRppypLr",
};

for (const [name, wallet] of Object.entries(FIXTURE_WALLETS)) {
  const base = makeContext();
  const sink: Recorded[] = [];
  const nowIso = new Date().toISOString();
  const ctx = { ...base, fetch: recordingFetch(base.fetch, sink), now: () => new Date(nowIso) };
  await walletAdapter.read(wallet, ctx);
  await stakeAdapter.read(wallet, ctx);
  await recentActivity(wallet, ctx, 20);
  const out = JSON.stringify({ wallet, nowIso, records: sink });
  if (/api-key=(?!<redacted>)/.test(out)) throw new Error("api key leaked into fixture, aborting");
  writeFileSync(new URL(`../src/engine/__fixtures__/${name}.json`, import.meta.url), out);
  console.log(name, wallet, sink.length, "responses,", Math.round(out.length / 1024), "KB");
}
