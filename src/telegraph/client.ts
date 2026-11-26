// Telegraph buyer: paid asks over x402 (Base Sepolia test USDC), pinned or routed, with receipts and a spend cap.
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const NET = "eip155:84532";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export interface Answer {
  intent: string;
  params: Record<string, unknown>;
  ok: boolean;
  status: number;
  minerId?: string;
  minerName?: string;
  servedRank?: number;
  result?: Record<string, unknown>;
  fieldStatus?: Record<string, string>;
  signalHash?: string;
  receipt?: Record<string, unknown>;
  costUsd?: number;
  ms: number;
  error?: string;
}

let spentUsd = 0;
const CAP_USD = Number(process.env.TELEGRAPH_DAILY_CAP_USD ?? "3");
export function spend() { return { spentUsd, capUsd: CAP_USD }; }

let payFetch: typeof fetch | null = null;
function payer(): typeof fetch {
  if (payFetch) return payFetch;
  const key = process.env.TELEGRAPH_PAYER_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("TELEGRAPH_PAYER_KEY is not set");
  payFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NET, client: new ExactEvmScheme(privateKeyToAccount(key)) }],
    spendControls: { allowedAssets: [{ network: NET, asset: USDC, maxAmountPerPayment: "50000" }] }, // $0.05 per answer max
  }) as typeof fetch;
  return payFetch;
}

/** One paid answer. minerId pins a miner; omit it to let Telegraph route to its top ranked miner. Never throws. */
export async function ask(intent: string, params: Record<string, unknown>, minerId?: string): Promise<Answer> {
  const t0 = Date.now();
  if (spentUsd >= CAP_USD) return { intent, params, ok: false, status: 0, ms: 0, error: `daily cap $${CAP_USD} reached` };
  try {
    const res = await payer()(`${NODE}/engine/v1/ask${minerId ? `/${minerId}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, params }),
    });
    const text = await res.text();
    let body: any = {};
    try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
    const r = res.headers.get("x-telegraph-receipt");
    const receipt = r ? JSON.parse(Buffer.from(r, "base64").toString()) : undefined;
    const costUsd = typeof body.cost_usd === "number" ? body.cost_usd : undefined;
    if (res.status === 200 && costUsd) spentUsd += costUsd;
    return {
      intent, params, ok: res.status === 200 && !!body.result, status: res.status,
      minerId: body.miner_id, minerName: body.miner_name, servedRank: body.served_rank,
      result: body.result, fieldStatus: body.field_status, signalHash: body.signal_hash,
      receipt, costUsd, ms: Date.now() - t0,
      error: res.status === 200 ? undefined : (body.reason || body.error || `HTTP ${res.status}`),
    };
  } catch (e) {
    return { intent, params, ok: false, status: 0, ms: Date.now() - t0, error: String(e).slice(0, 300) };
  }
}

export interface MinerInfo { id: string; slug: string; name: string; score?: number; rank?: number }

/** Live miners for an intent, best scored first (free endpoint). */
export async function minersFor(intent: string, limit = 5): Promise<MinerInfo[]> {
  const res = await fetch(`${NODE}/api/miners?limit=5000`);
  const all = (await res.json()) as any[];
  const out: MinerInfo[] = [];
  for (const m of all) {
    if (!(m.supported_intents || []).includes(intent)) continue;
    const s = (m.scores || []).find((x: any) => x.intent_id === intent);
    out.push({ id: String(m.id), slug: m.slug, name: m.name, score: s?.score, rank: s?.rank });
  }
  out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return out.slice(0, limit);
}

export type Role = "answer" | "verify" | "compare";
export type QuorumAnswer<T> = Answer & { role: Role; value?: T | undefined; used: boolean; rejectReason?: string | undefined };
export interface QuorumResult<T> {
  intent: string;
  answers: QuorumAnswer<T>[];
  value?: T | undefined; // agreed value, if any
  agreed: boolean;
  costUsd: number;
}

/**
 * Ask the routed top miner (answer) plus pinned miners (verify, compare) in parallel, extract a comparable value
 * from each, drop answers that fail `valid`, and accept a value only when at least `need` answers agree under `same`.
 */
export async function quorum<T>(opts: {
  intent: string;
  params: Record<string, unknown>;
  extract: (result: Record<string, unknown>) => T | undefined;
  valid?: (v: T) => string | undefined; // return a reason to reject
  same: (a: T, b: T) => boolean;
  pinned?: string[]; // miner ids for verify and compare
  need?: number;
}): Promise<QuorumResult<T>> {
  const pinned = opts.pinned ?? (await minersFor(opts.intent, 3)).map((m) => m.id);
  const plan: { role: Role; miner?: string }[] = [{ role: "answer" }, ...pinned.slice(0, 2).map((m, i) => ({ role: (i === 0 ? "verify" : "compare") as Role, miner: m }))];
  const raw = await Promise.all(plan.map((p) => ask(opts.intent, opts.params, p.miner)));
  const answers: QuorumAnswer<T>[] = raw.map((a, i): QuorumAnswer<T> => {
    const role = plan[i]?.role ?? "answer";
    if (!a.ok || !a.result) return { ...a, role, used: false, rejectReason: a.error || "no result" };
    const v = opts.extract(a.result);
    if (v === undefined || v === null) return { ...a, role, used: false, rejectReason: "field missing" };
    const bad = opts.valid?.(v);
    if (bad) return { ...a, role, value: v, used: false, rejectReason: bad };
    return { ...a, role, value: v, used: true };
  });
  const good = answers.filter((a) => a.used);
  const need = opts.need ?? 2;
  let value: T | undefined;
  for (const a of good) {
    const agreeing = good.filter((b) => opts.same(a.value as T, b.value as T));
    if (agreeing.length >= need) { value = a.value as T; break; }
  }
  for (const a of answers) if (a.used && value !== undefined && !opts.same(a.value as T, value)) { a.used = false; a.rejectReason = "disagrees with quorum"; }
  return { intent: opts.intent, answers, value, agreed: value !== undefined, costUsd: answers.reduce((s, a) => s + (a.costUsd ?? 0), 0) };
}
