export const short = (s: string, a = 4, b = 4) => (s.length <= a + b + 1 ? s : `${s.slice(0, a)}…${s.slice(-b)}`);

export function usd(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return "?";
  const abs = Math.abs(n);
  if (digits === undefined) {
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    digits = abs >= 1000 ? 0 : 2;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function relative(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  const h = Math.round(Math.abs(ms) / 3.6e6);
  const label = h >= 48 ? `${Math.round(h / 24)} days` : h >= 1 ? `${h} h` : `${Math.max(1, Math.round(Math.abs(ms) / 6e4))} min`;
  return ms >= 0 ? `in ${label}` : `${label} ago`;
}

const LABELS: Record<string, string> = {
  health: "Health",
  protocolHealth: "Health the protocol shows",
  collateralUsd: "Collateral",
  debtUsd: "Debt",
  mainCollateral: "Main collateral",
  price: "Price now",
  liquidationPrice: "Liquidation price",
  distancePct: "Distance to liquidation",
  idleUsd: "Sitting idle",
  apy: "Rate",
  yearlyUsd: "Per year",
  symbol: "Token",
  protocol: "Protocol",
  sharePct: "Share of wallet",
  usd: "Value",
};
export const label = (k: string) => LABELS[k] ?? sentence(k.replace(/([A-Z])/g, " $1").toLowerCase());

export function value(k: string, v: number | string): string {
  if (typeof v === "string") return v;
  if (/usd$/i.test(k)) return usd(v);
  if (/pct$/i.test(k) || k === "apy") return `${v}%`;
  if (/price/i.test(k)) return `$${v}`;
  return String(v);
}

export const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
export const sevClass = (s: string) => (s === "critical" || s === "high" ? "risk" : s === "medium" ? "warn" : "");
export const sevWord: Record<string, string> = { critical: "Act now", high: "Look today", medium: "Worth a look", low: "Minor", info: "For your info" };
