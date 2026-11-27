// GET /stats: everything Steady is doing in the background, from sources this API can see. Free, read only.
// Every block carries the time it was read; a block that could not be read says so instead of showing a number.
import type { LedgerEntry, LedgerLine } from "../ledger/store.js";
import { snapshot } from "./counters.js";

export const STEADY_MINER_ID = "7420317";
export const MINER_REGISTRATION = 6203;
export const LIQ_INTENT = "LIQUIDITY_DEPTH_VERIFY_GENERAL";
export const SUBMITTER = "0xFaEd7d2fD90a4095FF7D52809330ECBe1D9c2e2E";

type Block<T> = ({ ok: true } & T & { at: string }) | { ok: false; error: string; at: string };

export interface StatsDeps {
  fetch: typeof fetch;
  now: () => number;
  ledger: () => { entries: LedgerEntry[]; lines: LedgerLine[] };
  spend: () => { spentUsd: number; capUsd: number };
  node: string;
  minerUrl: string;
  botUrl?: string | undefined;
  bootedAt: string;
}

export function ledgerBlock(entries: LedgerEntry[], lines: LedgerLine[], now: number) {
  const settled = entries.filter((e) => e.prediction.outcome);
  const open = entries.filter((e) => !e.prediction.outcome);
  const hit = (v: boolean | undefined, o: boolean) => v === o;
  const steadyHits = settled.filter((e) => hit(e.prediction.steady.verdict, e.prediction.outcome!.verdict)).length;
  const fSettled = settled.filter((e) => e.prediction.frontier);
  const frontierHits = fSettled.filter((e) => hit(e.prediction.frontier!.verdict, e.prediction.outcome!.verdict)).length;
  const nextSettleAt = open.map((e) => e.prediction.settleAt).sort()[0] ?? null;
  const lastMadeAt = entries.map((e) => e.prediction.madeAt).sort().at(-1) ?? null;
  return {
    predictions: entries.length,
    open: open.length,
    settled: settled.length,
    overdue: open.filter((e) => Date.parse(e.prediction.settleAt) < now).length,
    nextSettleAt,
    lastMadeAt,
    steadyHits,
    frontierAnswered: entries.filter((e) => e.prediction.frontier).length,
    frontierSettled: fSettled.length,
    frontierHits,
    signedMemos: lines.length, // every ledger line is one signed memo (prediction, new version, or settlement)
  };
}

async function getJson(f: typeof fetch, url: string, ms: number): Promise<any> {
  const r = await f(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const fail = (e: unknown, at: string) => ({ ok: false as const, error: String((e as Error)?.message ?? e).slice(0, 120), at });

export function nodeMinerBlock(all: any[]) {
  const me = all.find((m) => String(m.id) === STEADY_MINER_ID);
  const rivals = all.filter((m) => (m.supported_intents ?? []).includes(LIQ_INTENT));
  if (!me) return { found: false as const, rivals: rivals.length };
  const score = (me.scores ?? []).find((s: any) => s.intent_id === LIQ_INTENT);
  return {
    found: true as const,
    id: STEADY_MINER_ID,
    status: String(me.activation_status ?? "unknown"),
    registeredAt: me.registered_at ?? null,
    requestsServed: typeof me.total_requests_served === "number" ? me.total_requests_served : 0,
    scored: me.scored === true,
    rank: typeof score?.rank === "number" ? score.rank : null,
    score: typeof score?.score === "number" ? score.score : null,
    epoch: score?.epoch_id ?? null,
    rivals: rivals.length,
  };
}

export function evalBlock(j: any) {
  const rows: any[] = Array.isArray(j?.rows) ? j.rows : [];
  const byIntent: Record<string, number> = {};
  for (const r of rows) byIntent[r.intent_id] = (byIntent[r.intent_id] ?? 0) + 1;
  return { rows: rows.length, eligible: rows.filter((r) => r.status === "eligible").length, byIntent, lastAt: rows.map((r) => r.updated_at ?? r.created_at).filter(Boolean).sort().at(-1) ?? null };
}

/** Builds /stats with per source caches, so a slow node never slows the page. */
export function makeStats(d: StatsDeps) {
  const cache = new Map<string, { at: number; v: unknown }>();
  const cached = async <T>(key: string, ttl: number, get: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && d.now() - hit.at < ttl) return hit.v as T;
    const v = await get();
    if ((v as any)?.ok !== false || !hit) cache.set(key, { at: d.now(), v }); // keep the last good value when a read fails
    else return hit.v as T;
    return v;
  };
  const iso = () => new Date(d.now()).toISOString();

  return async function stats() {
    const at = iso();
    const ledger = (() => {
      try { const l = d.ledger(); return { ok: true as const, ...ledgerBlock(l.entries, l.lines, d.now()), at }; } catch (e) { return fail(e, at); }
    })();
    const c = snapshot();
    const s = d.spend();
    const api = {
      ok: true as const, at, countingSince: c.since, bootedAt: d.bootedAt,
      memosSigned: c.counts.memosSigned ?? 0,
      telegraphPurchases: c.counts.telegraphPurchases ?? 0,
      telegraphSpendUsd: c.counts.telegraphSpendUsd ?? 0,
      walletChecks: c.counts.walletChecks ?? 0,
      txChecks: c.counts.txChecks ?? 0,
      fixesBuilt: c.counts.fixesBuilt ?? 0,
      spendTodayUsd: s.spentUsd, capTodayUsd: s.capUsd,
    };
    const [bot, miner, node, evaluator] = await Promise.all([
      cached<Block<any>>("bot", 30_000, async () => {
        const t = iso();
        if (!d.botUrl) return { ok: false, error: "bot stats url not set", at: t };
        try { return { ok: true, ...(await getJson(d.fetch, `${d.botUrl}/stats`, 6000)), at: t }; } catch (e) { return fail(e, t); }
      }),
      cached<Block<any>>("miner", 30_000, async () => {
        const t = iso();
        try { return { ok: true, ...(await getJson(d.fetch, `${d.minerUrl}/stats`, 6000)), at: t }; } catch (e) { return fail(e, t); }
      }),
      cached<Block<any>>("node", 10 * 60_000, async () => {
        const t = iso();
        try { return { ok: true, ...nodeMinerBlock(await getJson(d.fetch, `${d.node}/api/miners?limit=5000`, 25_000)), at: t }; } catch (e) { return fail(e, t); }
      }),
      cached<Block<any>>("eval", 10 * 60_000, async () => {
        const t = iso();
        try { return { ok: true, ...evalBlock(await getJson(d.fetch, `${d.node}/api/evalpool/submissions/mine?submitter=${SUBMITTER}`, 15_000)), at: t }; } catch (e) { return fail(e, t); }
      }),
    ]);
    return { at, ledger, api, bot, miner, node, evaluator, registration: MINER_REGISTRATION };
  };
}
