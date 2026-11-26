// Records real mainnet responses for the LP and perp adapters into src/engine/__fixtures__/lp/. Run: npx tsx scripts/record-lp.ts [name]
// The RPC key is stripped from every recorded request. Fixtures hold public chain data of the wallets listed below.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeContext } from "../src/engine/context.js";
import { recordingFetch, type RecordedCall } from "../src/engine/__fixtures__/replay.js";
import { orcaAdapter } from "../src/engine/adapters/orca.js";
import { raydiumAdapter } from "../src/engine/adapters/raydium.js";
import { meteoraAdapter } from "../src/engine/adapters/meteora.js";
import { driftAdapter } from "../src/engine/adapters/drift.js";
import { jupiterPerpsAdapter } from "../src/engine/adapters/jupiterPerps.js";
import { poolLiquidity } from "../src/engine/pools/liquidity.js";
import { exitCost } from "../src/engine/risk/exit.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/engine/__fixtures__/lp");
mkdirSync(dir, { recursive: true });
const SOL = "So11111111111111111111111111111111111111112";

const jobs: Record<string, (ctx: ReturnType<typeof makeContext>) => Promise<unknown>> = {
  "orca-multi": (c) => orcaAdapter.read("9z4rZ1hjspAXHkG8CSTXqAUk22kv19noDf7rvdTa5WHJ", c),
  "orca-bundle": (c) => orcaAdapter.read("J68JeFQVr4uCZP7WvWLHXAWVaLVFbFXNbFREh6vXtCVW", c),
  "raydium-clmm": (c) => raydiumAdapter.read("CorMxGXd3kGJw6sravC5US24TqrURQ6fq4QS3CymAwNV", c),
  "raydium-amm": (c) => raydiumAdapter.read("DgbCWnbXg43nmeiAveMCkUUPEpAr3rZo3iop3TyP6S63", c),
  "meteora-dlmm": (c) => meteoraAdapter.read("9ZNSLCTLBkrCYfpBdnybhaWdmei6y1ysqXWpkb3dq2Hs", c),
  "drift-perp": (c) => driftAdapter.read("Fo2qidJ2rEkTJMc3W8hrQKQMxniaTw6M28NpQTuvVCAy", c),
  "jup-perp-sol": (c) => jupiterPerpsAdapter.read("8Mtzci2dVHHFe7kVkXFCt9NegD84scFwGLjUp1WRZzoH", c),
  "jup-perp-btc": (c) => jupiterPerpsAdapter.read("8dXAExL3ikQHZ753aeH2ygjert68r7LQ9NzZXFpgfSk6", c),
  "pool-orca": (c) => poolLiquidity(c, "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"),
  "pool-raydium-amm": (c) => poolLiquidity(c, "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"),
  "pool-meteora": (c) => poolLiquidity(c, "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y"),
  "exit-raydium-amm": (c) => exitCost(c, "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", SOL, 1000),
  "exit-orca": (c) => exitCost(c, "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", SOL, 1000),
};

const only = process.argv[2];
for (const [name, run] of Object.entries(jobs)) {
  if (only && only !== name) continue;
  const base = makeContext();
  const calls: RecordedCall[] = [];
  const now = new Date();
  const ctx = { ...base, fetch: recordingFetch(base.fetch, calls), now: () => now };
  try {
    const result: any = await run(ctx);
    writeFileSync(`${dir}/${name}.json`, JSON.stringify({ recordedAt: now.toISOString(), expected: result, calls }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    console.log(name, "ok", calls.length, "calls", Array.isArray(result?.positions) ? `${result.positions.length} positions` : "");
  } catch (e) {
    console.log(name, "FAILED", String(e).replace(/api-key=[^&\s"]+/g, "api-key=***"));
  }
}
process.exit(0);
