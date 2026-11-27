// advise(wallet): read the whole wallet, apply rules, add verified opportunities and Telegraph checks on the protocols held.
import { scrub } from "../adapters/util.js";
import type { AdapterContext, AdapterResult, Source } from "../types.js";
import type { Advice, Evidence, Finding } from "./types.js";
import { readPortfolio } from "../portfolio.js";
import { holdingFindings, loanFindings, STABLES, totalUsd } from "./rules.js";
import { ask, quorum, type Answer } from "../../telegraph/client.js";

const LLAMA_POOLS = "https://yields.llama.fi/pools";
const LENDING_PROJECTS: Record<string, string> = { "kamino-lend": "kamino", "marginfi-lending": "marginfi", "save": "save" };

export interface Rate { protocol: string; symbol: string; apy: number; tvlUsd: number; pool: string; source: Source }

/** Public supply rates for stablecoins on Solana lending markets (DefiLlama, which reads the protocols). */
export async function stableRates(ctx: AdapterContext): Promise<Rate[]> {
  const res = await ctx.fetch(LLAMA_POOLS);
  const json = (await res.json()) as { data: any[] };
  const at = ctx.now().toISOString();
  return json.data
    .filter((p) => p.chain === "Solana" && LENDING_PROJECTS[p.project] && ["USDC", "USDT", "PYUSD", "USDS"].includes(p.symbol) && p.tvlUsd > 1_000_000 && typeof p.apy === "number")
    .map((p) => ({ protocol: LENDING_PROJECTS[p.project]!, symbol: p.symbol, apy: p.apy, tvlUsd: p.tvlUsd, pool: p.pool, source: { kind: "price_api" as const, ref: `${LLAMA_POOLS} pool ${p.pool}`, fetchedAt: at } }));
}

export function toEvidence(a: Answer & { role?: "answer" | "verify" | "compare"; used?: boolean; rejectReason?: string | undefined }, summary: string): Evidence {
  const receiptHash = (a.receipt as any)?.receipt_hash as string | undefined;
  return { intent: a.intent, minerId: a.minerId, minerName: a.minerName, role: a.role, used: a.used ?? a.ok, rejectReason: a.rejectReason ?? a.error, signalHash: a.signalHash, receiptHash, costUsd: a.costUsd, summary };
}

/** Idle stablecoins in the wallet that could earn a higher verified rate; the rate is cross checked with Telegraph miners. */
export async function rateOpportunities(r: AdapterResult, ctx: AdapterContext, opts: { telegraph: boolean }): Promise<{ findings: Finding[]; cost: number }> {
  const idle = r.positions.filter((p) => p.kind === "token" && p.mint && STABLES[p.mint] && (p.usd ?? 0) >= 50);
  if (idle.length === 0) return { findings: [], cost: 0 };
  const rates = await stableRates(ctx);
  const out: Finding[] = [];
  let cost = 0;
  for (const p of idle) {
    const sym = STABLES[p.mint!]!;
    const best = rates.filter((x) => x.symbol === sym).sort((a, b) => b.apy - a.apy)[0];
    if (!best || best.apy < 1) continue;
    const evidence: Evidence[] = [];
    if (opts.telegraph) {
      const q = await quorum<number>({
        intent: "CRYPTO_YIELD_RATE_GENERAL",
        params: { project: best.protocol === "kamino" ? "kamino-lend" : best.protocol, symbol: sym, chain: "Solana" },
        extract: (res) => (typeof res.supply_apy === "number" ? res.supply_apy : undefined),
        valid: (v) => (v < 0 || v > 60 ? `implausible ${v}% supply APY` : Math.abs(v - best.apy) > Math.max(1.5, best.apy * 0.35) ? `far from public rate ${best.apy.toFixed(2)}%` : undefined),
        same: (a, b) => Math.abs(a - b) <= Math.max(0.5, a * 0.15),
        need: 1,
      });
      cost += q.costUsd;
      for (const a of q.answers) evidence.push(toEvidence(a, a.result ? `supply APY ${String(a.result.supply_apy)}%` : a.error ?? "no answer"));
    }
    const buildable = rates.filter((x) => x.symbol === sym && x.protocol === "kamino" && x.apy >= 1).sort((a, b) => b.apy - a.apy)[0];
    const yearly = (p.usd! * best.apy) / 100;
    out.push({
      id: `opportunity:better_rate:${p.mint}`, kind: "opportunity", code: "better_rate", severity: "info",
      title: `${p.amount.toFixed(2)} ${sym} is idle; ${best.protocol} pays ${best.apy.toFixed(2)}% (about $${yearly.toFixed(0)} a year)`,
      numbers: { symbol: sym, idleUsd: Math.round(p.usd! * 100) / 100, apy: Math.round(best.apy * 100) / 100, protocol: best.protocol, yearlyUsd: Math.round(yearly) },
      sources: [...p.sources, best.source], evidence,
      // Only Kamino deposits have a builder today, so the prepared fix uses the best Kamino rate even when another market pays more.
      ...(buildable ? { fix: { action: "deposit", protocol: "kamino", mintIn: p.mint!, amount: p.amount, reason: `Deposit idle ${sym} into Kamino at ${buildable.apy.toFixed(2)}%` } } : {}),
    });
  }
  return { findings: out, cost };
}

const ALERT_WORDS = /\b(exploit|exploited|hack|hacked|drained|paused|halt(ed)?|depeg(ged)?|insolven|bad debt|vulnerab|attack)\w*/i;
const OFF_TOPIC = /closest match only|not an exact answer|no (recent )?(news|results) found|insufficient data/i;

/** Code decides whether a news answer is a credible incident report about this protocol.
 *  Miners often restate the query ("Recent coverage of kamino exploit ...") before listing headlines, so only the
 *  reported items count: quoted headlines when the answer has them, otherwise sentences that do not restate the query. */
export function judgeNews(protocol: string, text: string): { credible: boolean; keyword?: string; headline?: string; reason?: string } {
  if (!text.trim()) return { credible: false, reason: "empty answer" };
  if (OFF_TOPIC.test(text)) return { credible: false, reason: "miner says it is not an exact answer" };
  const name = new RegExp(`\\b${protocol.replace(/[-]/g, "[ -]?")}\\b`, "i");
  const quoted = [...text.matchAll(/(?:^|[\s:(\[])["'“‘]([^\n]{12,300}?)["'”’](?=[\s,.;:)\]]|$)/g)].map((m) => m[1]!);
  const restates = /\b(recent )?(coverage|news|results?|search(ed)?|query|asked) (of|for|about|on)\b/i;
  const items = quoted.length > 0 ? quoted : text.split(/(?<=[.!?])\s+/).filter((s) => !restates.test(s));
  const hit = items.find((s) => name.test(s) && ALERT_WORDS.test(s));
  if (!hit) return { credible: true, reason: "no incident reported about this protocol" };
  return { credible: true, keyword: (hit.match(ALERT_WORDS)?.[0] ?? "").toLowerCase(), headline: hit.trim().slice(0, 200) };
}

// One paid news answer per protocol is reused for 3 hours, so the 15 minute watch sweep does not rebuy the same news.
const NEWS_TTL_MS = 3 * 3600_000;
const newsCache = new Map<string, { at: number; answer: Answer }>();
async function newsFor(proto: string): Promise<Answer & { cached?: boolean }> {
  const hit = newsCache.get(proto);
  if (hit && Date.now() - hit.at < NEWS_TTL_MS) return { ...hit.answer, cached: true };
  const a = await ask("NEWS_SEARCH_GENERAL", { query: `${proto} Solana DeFi protocol news this week` });
  if (a.ok) newsCache.set(proto, { at: Date.now(), answer: a });
  return a;
}

/** Ask Telegraph news miners about each protocol the wallet uses; raise an alert only when the answer itself reports an incident about that protocol. */
export async function protocolAlerts(r: AdapterResult): Promise<{ findings: Finding[]; cost: number; checks: Evidence[]; reused: number }> {
  const protocols = [...new Set([...r.positions.map((p) => p.protocol), ...r.loans.map((l) => l.protocol)])].filter((p) => !["wallet", "stake", "lst"].includes(p));
  const out: Finding[] = [];
  let cost = 0;
  let reused = 0;
  const checks: Evidence[] = [];
  await Promise.all(protocols.map(async (proto) => {
    const a = await newsFor(proto);
    if (!a.cached) cost += a.costUsd ?? 0;
    const text = String(a.result?.answer ?? a.result?.brief ?? "");
    const verdict = judgeNews(proto, text);
    const ev = toEvidence({ ...a, used: verdict.credible, rejectReason: verdict.reason }, text.slice(0, 280) || a.error || "no answer");
    checks.push(ev);
    if (a.cached) reused++;
    if (a.ok && verdict.credible && verdict.keyword) {
      out.push({ id: `risk:protocol_alert:${proto}`, kind: "risk", code: "protocol_alert", severity: "medium", title: `A news report links ${proto} to an incident (${verdict.keyword}): read it before adding more`, numbers: { protocol: proto, keyword: verdict.keyword, headline: verdict.headline ?? "" }, sources: [], evidence: [ev] });
    }
  }));
  return { findings: out, cost, checks, reused };
}

export async function advise(wallet: string, ctx: AdapterContext, opts: { telegraph?: boolean } = {}): Promise<Advice> {
  const telegraph = opts.telegraph ?? true;
  const r = await readPortfolio(wallet, ctx);
  const findings: Finding[] = [...loanFindings(r.loans), ...holdingFindings(r.positions)];
  let cost = 0;
  const [rates, alerts] = await Promise.all([
    rateOpportunities(r, ctx, { telegraph }).catch((e) => { r.gaps.push(`rates: ${scrub(String(e)).slice(0, 120)}`); return { findings: [], cost: 0 }; }),
    telegraph ? protocolAlerts(r).catch((e) => { r.gaps.push(`protocol alerts: ${scrub(String(e)).slice(0, 120)}`); return { findings: [], cost: 0, checks: [] as Evidence[], reused: 0 }; }) : Promise.resolve({ findings: [], cost: 0, checks: [] as Evidence[], reused: 0 }),
  ]);
  findings.push(...rates.findings, ...alerts.findings);
  cost += rates.cost + alerts.cost;
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { wallet, at: ctx.now().toISOString(), totalUsd: totalUsd(r), findings, gaps: r.gaps, costUsd: Math.round(cost * 1000) / 1000, checks: alerts.checks, reusedAnswers: alerts.reused ?? 0 };
}
