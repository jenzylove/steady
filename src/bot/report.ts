// Format Advice into a short Telegram message (HTML parse mode). Pure: no network.
import type { Advice, Finding, Severity } from "../engine/advice/types.js";

export const APP_URL = "https://steady.jdollar.site/app";
export const MAX_LEN = 3500;
export const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
export const SEV_EMOJI: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "🟢" };

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function sevRank(s: Severity): number { return SEV_ORDER.indexOf(s); }
export function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
}
export function shortAddr(a: string): string { return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a; }
export function fixLink(wallet: string, findingId: string): string {
  return `${APP_URL}?wallet=${encodeURIComponent(wallet)}#${encodeURIComponent(findingId)}`;
}
function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 });
}
const LABELS: Record<string, [string, string?]> = {
  health: ["health"], collateralUsd: ["collateral", "$"], debtUsd: ["debt", "$"], price: ["price now", "$"],
  liquidationPrice: ["liquidation price", "$"], distancePct: ["distance", "%"], protocolHealth: ["protocol says"],
  sharePct: ["share", "%"], usd: ["value", "$"], amount: ["amount"], apy: ["APY", "%"], yearlyUsd: ["a year", "$"], idleUsd: ["idle", "$"],
};
function numbersLine(f: Finding): string {
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return Object.entries(f.numbers).filter(([k]) => LABELS[k]).slice(0, 4).map(([k, v]) => {
    const [label, unit] = LABELS[k]!;
    const val = typeof v === "number" ? fmt(v) : v;
    return unit === "$" ? `${label} $${val}` : unit === "%" ? `${label} ${val}%` : `${label} ${val}`;
  }).join(" · ");
}

export function findingBlock(wallet: string, f: Finding): string {
  const lines = [`${SEV_EMOJI[f.severity]} <b>${esc(f.severity.toUpperCase())}</b> ${esc(f.title)}`];
  const n = numbersLine(f);
  if (n) lines.push(`<i>${esc(n)}</i>`);
  if (f.fix) lines.push(`Fix ready: ${esc(f.fix.reason)}\n<a href="${esc(fixLink(wallet, f.id))}">Review and sign in Phantom</a>`);
  return lines.join("\n");
}

export function verifiedLine(a: Advice): string {
  const ev = [...(a.checks ?? []), ...a.findings.flatMap((f) => f.evidence)];
  const used = ev.filter((e) => e.used).length;
  const rejected = ev.length - used;
  if (ev.length === 0) return "Verified: on chain reads only, no Telegraph answers this run.";
  return `Verified with ${used} Telegraph answer${used === 1 ? "" : "s"} used, ${rejected} rejected.`;
}

export function formatReport(a: Advice, opts: { max?: number } = {}): string {
  const max = opts.max ?? MAX_LEN;
  const head = `<b>Steady</b> · <code>${esc(shortAddr(a.wallet))}</code>\nNet worth after debt: <b>${fmtUsd(a.totalUsd)}</b>`;
  const foot = verifiedLine(a);
  const sorted = sortFindings(a.findings);
  const parts = [head];
  if (sorted.length === 0) parts.push("Nothing needs attention right now.");
  const build = (blocks: string[]) => {
    const extra = sorted.length - blocks.length;
    return [...parts, ...blocks, ...(extra > 0 ? [`+${extra} more in the app`] : []), foot].join("\n\n");
  };
  const blocks: string[] = [];
  for (const f of sorted.slice(0, 5)) {
    const b = findingBlock(a.wallet, f);
    if (build([...blocks, b]).length > max) break;
    blocks.push(b);
  }
  const msg = build(blocks);
  return msg.length > max ? msg.slice(0, max) : msg;
}

/** Short alert for watch heartbeats: only the findings that are new or worse. */
export function formatAlert(wallet: string, findings: Finding[]): string {
  const blocks = sortFindings(findings).slice(0, 3).map((f) => findingBlock(wallet, f));
  const msg = [`<b>Steady alert</b> · <code>${esc(shortAddr(wallet))}</code>`, ...blocks].join("\n\n");
  return msg.length > MAX_LEN ? msg.slice(0, MAX_LEN) : msg;
}
