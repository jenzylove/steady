// Background jobs for the hosted ledger: seed once, settle due calls, fill missing frontier answers, make a fresh batch daily.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdapterContext } from "../engine/types.js";
import { Ledger } from "./store.js";
import { settleDue } from "./settle.js";
import { askFrontier, askFrontierInformed, hasFrontierKey } from "./frontier.js";
import { makeAll } from "./make.js";
import { anchorPending } from "./anchor.js";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[ledger]", ...a);

export function seedIfEmpty(ledger: Ledger): void {
  const seed = resolve(process.cwd(), "ledger", "seed-ledger.jsonl");
  if (!existsSync(ledger.path) && existsSync(seed)) {
    mkdirSync(dirname(ledger.path), { recursive: true });
    copyFileSync(seed, ledger.path);
    log("seeded from", seed);
  }
}

export async function fillFrontier(ledger: Ledger, ctx: AdapterContext): Promise<number> {
  if (!hasFrontierKey()) return 0;
  let n = 0;
  for (const e of ledger.load()) {
    if (e.settlement) continue;
    if (e.prediction.frontier && e.prediction.frontierInformed) continue;
    try {
      const patch: Partial<typeof e.prediction> = {};
      if (!e.prediction.frontier) patch.frontier = await askFrontier(e.prediction, ctx.now());
      if (!e.prediction.frontierInformed) patch.frontierInformed = await askFrontierInformed(e.prediction);
      await ledger.update(e.prediction.id, patch); n++;
    }
    catch (err) { log("frontier failed", e.prediction.id, String(err).slice(0, 120)); break; }
  }
  return n;
}

export function startLedgerJobs(ctx: AdapterContext): void {
  const ledger = new Ledger();
  seedIfEmpty(ledger);
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const f = await fillFrontier(ledger, ctx);
      if (f) log("frontier answers added", f);
      if (process.env.TELEGRAPH_PAYER_KEY && process.env.LEDGER_ANCHOR !== "off") {
        const a = await anchorPending(ledger).catch((e) => { log("anchor failed", String(e).slice(0, 160)); return []; });
        for (const x of a) log("anchored batch", x.batch, x.count, "calls", x.txHash);
      }
      const r = await settleDue(ledger, ctx);
      if (r.settled.length || r.failed.length) log("settled", r.settled.length, "failed", r.failed.length);
      const last = ledger.load().map((e) => e.prediction.madeAt).sort().at(-1);
      if (!last || Date.now() - Date.parse(last) > 23 * 3600_000) {
        const made = await makeAll(ctx);
        for (const p of made.predictions) await ledger.append(p);
        log("made", made.predictions.length, "new predictions");
        await fillFrontier(ledger, ctx);
      }
    } catch (e) { log("tick error", String(e).slice(0, 200)); }
    finally { busy = false; }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, Number(process.env.LEDGER_TICK_MIN ?? "15") * 60_000);
}
