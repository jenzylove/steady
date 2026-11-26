// Records real responses for the lending adapters into src/engine/__fixtures__/lending-<protocol>.json.
// Usage: npx tsx scripts/record-lending.ts
// Large API bodies (Save reserves, Kamino obligation state) are trimmed to the fields the adapters read.
import { writeFileSync } from "node:fs";
import { makeContext } from "../src/engine/context.js";
import { kaminoAdapter } from "../src/engine/adapters/kamino.js";
import { marginfiAdapter } from "../src/engine/adapters/marginfi.js";
import { saveAdapter } from "../src/engine/adapters/save.js";
import { recordingFetch, type RecordedCall as Recorded } from "../src/engine/__fixtures__/replay.js";
import type { Adapter } from "../src/engine/types.js";

const WALLETS: Record<string, { adapter: Adapter; wallets: string[] }> = {
  kamino: {
    adapter: kaminoAdapter,
    // 44tD: two obligations (JLP/USDT, USDC+SOL against JitoSOL+bSOL with borrow factor 1.25); 8HhZ: elevation group SOL/JitoSOL
    wallets: ["44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS", "8HhZCE1LqiPy3kvMqgfPHgcBXocHUhSwUD9MhzbUymre"],
  },
  marginfi: {
    adapter: marginfiAdapter,
    // 7USM: mSOL against SOL (e-mode); GaTE: USDC against USDT
    wallets: ["7USMPgaFyArTX55e6rD3YujsSZmLntFStrkJwxaZMTUt", "GaTEjq7bd1MGg9xrTT2iNBfKm42EPtdTPdg46n6cQd4x"],
  },
  save: {
    adapter: saveAdapter,
    // GQP9: a large live obligation plus a stale one valued from its stored numbers; 7P1b: two small obligations
    wallets: ["GQP9XKoRfwo229MA8iDq8GsC4piAruxrg578QbTNQuqD", "7P1btPmUvyWwnxfhkKAMdZnCbDxLYyXxBKR1mY3jDKmR"],
  },
};

function trim(protocol: string, records: Recorded[], reserves: Set<string>): Recorded[] {
  return records.map((r) => {
    if (protocol === "save" && r.key.includes("/v1/reserves?scope=all")) {
      const j = JSON.parse(r.body) as { results: { reserve: { address?: string; pubkey?: string } }[] };
      j.results = j.results.filter((x) => reserves.has((x.reserve.address ?? x.reserve.pubkey) as string));
      return { ...r, body: JSON.stringify(j) };
    }
    if (protocol === "save" && r.key.includes("/v1/markets/configs")) {
      const j = JSON.parse(r.body) as { reserves: { address: string }[] }[];
      const kept = j.map((m) => ({ reserves: m.reserves.filter((x) => reserves.has(x.address)) })).filter((m) => m.reserves.length > 0);
      return { ...r, body: JSON.stringify(kept) };
    }
    if (protocol === "kamino" && r.key.includes("api.kamino.finance")) {
      const j = JSON.parse(r.body) as { obligationAddress: string; refreshedStats: unknown }[];
      return { ...r, body: JSON.stringify(j.map((o) => ({ obligationAddress: o.obligationAddress, refreshedStats: o.refreshedStats }))) };
    }
    return r;
  });
}

for (const [protocol, { adapter, wallets }] of Object.entries(WALLETS)) {
  const base = makeContext();
  const sink: Recorded[] = [];
  const nowIso = new Date().toISOString();
  const ctx = { ...base, fetch: recordingFetch(base.fetch, sink), now: () => new Date(nowIso) };
  const reserves = new Set<string>();
  for (const w of wallets) {
    const r = await adapter.read(w, ctx);
    for (const p of r.positions) if (typeof p.extra?.["reserve"] === "string") reserves.add(p.extra["reserve"] as string);
    console.log(protocol, w, r.loans.length, "loans,", r.gaps.length, "gaps");
  }
  const out = JSON.stringify({ wallets, nowIso, records: trim(protocol, sink, reserves) });
  if (/api-key=(?!REDACTED)/.test(out) || (process.env.HELIUS_API_KEY && out.includes(process.env.HELIUS_API_KEY))) throw new Error("api key leaked into fixture, aborting");
  writeFileSync(new URL(`../src/engine/__fixtures__/lending-${protocol}.json`, import.meta.url), out);
  console.log(protocol, sink.length, "responses,", Math.round(out.length / 1024), "KB");
}
