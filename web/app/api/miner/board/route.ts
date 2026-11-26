// Every known pool, read by Steady's live miner in parallel. Marked as the site's own reads so the miner counts them apart.
import { NextResponse } from "next/server";
import { KNOWN_POOLS } from "@/lib/pools";

const BASE = process.env.MINER_URL ?? "https://steady-miner-production.up.railway.app";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await Promise.all(KNOWN_POOLS.map(async (p) => {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/liquidity?pool=${p.address}&chain=solana`, { cache: "no-store", headers: { "x-steady-board": "1" }, signal: AbortSignal.timeout(25000) });
      const text = await r.text();
      let body: unknown; try { body = JSON.parse(text); } catch { body = { error: "bad_response", reason: text.slice(0, 200) }; }
      return { pool: p, status: r.status, ms: Date.now() - t0, body };
    } catch (e) {
      return { pool: p, status: 0, ms: Date.now() - t0, body: { error: "unreachable", reason: String(e).slice(0, 120) } };
    }
  }));
  return NextResponse.json({ at: new Date().toISOString(), request: `${BASE}/liquidity?pool=<address>&chain=solana`, rows });
}
