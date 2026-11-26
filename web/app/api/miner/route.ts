// Server side pass through to Steady's live Telegraph miner (it sends no CORS headers).
import { NextResponse } from "next/server";

const BASE = process.env.MINER_URL ?? "https://steady-miner-production.up.railway.app";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const pool = u.searchParams.get("pool") ?? "";
  const chain = u.searchParams.get("chain") ?? "solana";
  const started = Date.now();
  try {
    const r = await fetch(`${BASE}/liquidity?pool=${encodeURIComponent(pool)}&chain=${encodeURIComponent(chain)}`, { cache: "no-store", headers: { "x-steady-board": "1" }, signal: AbortSignal.timeout(25000) });
    const text = await r.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { error: "bad_response", reason: text.slice(0, 200) }; }
    return NextResponse.json({ status: r.status, ms: Date.now() - started, body });
  } catch (e) {
    return NextResponse.json({ status: 0, ms: Date.now() - started, body: { error: "unreachable", reason: `The miner did not answer: ${String(e).slice(0, 120)}` } });
  }
}
