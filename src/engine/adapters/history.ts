import type { AdapterContext } from "../types.js";
import { fetchRetry, scrub } from "./util.js";

export interface ActivityItem {
  signature: string;
  timestamp: number; // unix seconds
  type: string;
  description: string;
  counterparties: string[];
}

export interface ActivityResult {
  items: ActivityItem[];
  gaps: string[];
}

const HELIUS_TX = "https://api.helius.xyz/v0/addresses";

function apiKeyFrom(ctx: AdapterContext): string | undefined {
  try {
    return new URL(ctx.heliusRpcUrl).searchParams.get("api-key") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Last transactions for a wallet, summarised. Counterparties are every other address that sent or received value. */
export async function recentActivity(wallet: string, ctx: AdapterContext, limit = 50): Promise<ActivityResult> {
  const gaps: string[] = [];
  const key = apiKeyFrom(ctx);
  if (!key) return { items: [], gaps: ["Transaction history not read: no Helius API key in context."] };
  const items: ActivityItem[] = [];
  let before: string | undefined;
  try {
    while (items.length < limit) {
      const n = Math.min(100, limit - items.length);
      const url = `${HELIUS_TX}/${wallet}/transactions?api-key=${key}&limit=${n}${before ? `&before=${before}` : ""}`;
      const res = await fetchRetry(ctx, url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batch = (await res.json()) as any[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const t of batch) {
        const cp = new Set<string>();
        const add = (a?: string | null) => {
          if (a && a !== wallet) cp.add(a);
        };
        for (const nt of t.nativeTransfers ?? []) {
          add(nt.fromUserAccount);
          add(nt.toUserAccount);
        }
        for (const tt of t.tokenTransfers ?? []) {
          add(tt.fromUserAccount);
          add(tt.toUserAccount);
        }
        items.push({
          signature: t.signature,
          timestamp: t.timestamp,
          type: t.type ?? "UNKNOWN",
          description: t.description ?? "",
          counterparties: [...cp],
        });
      }
      before = batch[batch.length - 1]?.signature;
      if (batch.length < n || !before) break;
    }
  } catch (e) {
    gaps.push(`Transaction history incomplete (${items.length} read): ${scrub(String((e as Error).message ?? e))}`);
  }
  return { items: items.slice(0, limit), gaps };
}
