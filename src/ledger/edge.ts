// Loans at the edge: every few hours Steady sweeps Kamino main market loans within reach of liquidation, remembers when it
// first saw each one, and later checks the chain for a liquidation of that loan. The proof page shows how much debt was
// liquidated after Steady had already flagged it, with a link to each wallet, where the fix and Guard are one click away.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdapterContext } from "../engine/types.js";
import { getMultiple, pk } from "../engine/adapters/lib.js";
import { findObligations } from "./make.js";

export const EDGE_HEALTH_MAX = 1.12;
export const EDGE_FILE = process.env.EDGE_PATH ?? resolve(dirname(process.env.LEDGER_PATH ?? resolve(process.cwd(), "data", "ledger.jsonl")), "edge.json");

export interface EdgeLoan {
  obligation: string;
  owner: string;
  firstSeenAt: string;
  firstHealth: number;
  debtUsd: number;
  lastCheckedAt?: string | undefined;
  liquidated?: { at: string; signature: string } | undefined;
}

export function loadEdge(file = EDGE_FILE): EdgeLoan[] {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as EdgeLoan[]) : []; } catch { return []; }
}
export function saveEdge(rows: EdgeLoan[], file = EDGE_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(rows));
  renameSync(`${file}.tmp`, file);
}

async function rpc<T>(ctx: AdapterContext, method: string, params: unknown[]): Promise<T> {
  const r = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** Add loans newly within reach of liquidation. Loans already tracked keep their first sighting. */
export async function sweepEdge(ctx: AdapterContext, rows: EdgeLoan[]): Promise<number> {
  const known = new Set(rows.map((r) => r.obligation));
  const fresh = (await findObligations(ctx, 1_000, 5_000_000, 1.0, EDGE_HEALTH_MAX)).filter((c) => !known.has(c.address));
  if (!fresh.length) return 0;
  const accs = await getMultiple(ctx, fresh.map((c) => c.address));
  const now = ctx.now().toISOString();
  fresh.forEach((c, i) => {
    const a = accs.accounts[i];
    if (a) rows.push({ obligation: c.address, owner: pk(a.data, 64), firstSeenAt: now, firstHealth: +c.health.toFixed(4), debtUsd: Math.round(c.debtUsd) });
  });
  return fresh.length;
}

export const isLiquidation = (logs: string[]) => logs.some((l) => /Instruction: LiquidateObligation/i.test(l));

/** Look for a liquidation of each tracked loan after Steady first saw it. Checks the least recently checked loans first. */
export async function checkLiquidations(ctx: AdapterContext, rows: EdgeLoan[], cap = 100): Promise<number> {
  let found = 0;
  const due = rows.filter((r) => !r.liquidated).sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? "")).slice(0, cap);
  for (const r of due) {
    try {
      const since = Date.parse(r.firstSeenAt) / 1000;
      const sigs = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>(ctx, "getSignaturesForAddress", [r.obligation, { limit: 25 }]);
      for (const s of sigs.filter((x) => !x.err && (x.blockTime ?? 0) >= since)) {
        const tx = await rpc<{ meta?: { logMessages?: string[] } } | null>(ctx, "getTransaction", [s.signature, { maxSupportedTransactionVersion: 0, encoding: "json" }]);
        if (tx?.meta?.logMessages && isLiquidation(tx.meta.logMessages)) {
          r.liquidated = { at: new Date((s.blockTime ?? 0) * 1000).toISOString(), signature: s.signature };
          found++; break;
        }
      }
      r.lastCheckedAt = ctx.now().toISOString();
    } catch { /* try again next run */ }
  }
  return found;
}

export function edgeSummary(rows: EdgeLoan[]) {
  const liq = rows.filter((r) => r.liquidated);
  return {
    tracked: rows.length,
    trackedDebtUsd: rows.reduce((s, r) => s + r.debtUsd, 0),
    liquidated: liq.length,
    liquidatedDebtUsd: liq.reduce((s, r) => s + r.debtUsd, 0),
    since: rows.map((r) => r.firstSeenAt).sort()[0] ?? null,
  };
}
