// Steady API: advice, fix building, check before signing, ledger, miner status, and Guard. Never holds a key; the only
// transaction it ever sends is a rescue the owner signed in advance through Guard.
import "dotenv/config";
import { scrub } from "../engine/adapters/util.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeContext } from "../engine/context.js";
import { readPortfolio } from "../engine/portfolio.js";
import { advise } from "../engine/advice/advise.js";
import { buildFix } from "../fix/build.js";
import { presign, isAddress } from "../presign/check.js";
import { sign, verify, canonical, type Signed } from "../memo/memo.js";
import { privateKeyToAccount } from "viem/accounts";
import { spend } from "../telegraph/client.js";
import type { Advice, FixSpec } from "../engine/advice/types.js";
import { startLedgerJobs } from "../ledger/jobs.js";
import { Ledger } from "../ledger/store.js";
import { makeStats } from "../stats/aggregate.js";
import { bump } from "../stats/counters.js";
import { guardRoute, startGuardJobs } from "../guard/routes.js";

const ctx = makeContext();
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",");
const perIp = new Map<string, { day: string; n: number }>();
const FREE_RUNS = Number(process.env.FREE_RUNS_PER_DAY ?? "20");

const GLOBAL_PER_MIN = Number(process.env.HEAVY_CALLS_PER_MIN ?? "30");
let minute = { at: 0, n: 0 };

/** The client IP as the last proxy saw it. Railway appends the real address, so the first entries are caller controlled. */
function clientIp(req: IncomingMessage): string {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) ?? req.socket.remoteAddress ?? "?";
}

/** Free daily runs per IP, plus one global ceiling per minute so a script cannot burn the RPC and Telegraph budget. */
function allow(req: IncomingMessage): boolean {
  const t = Math.floor(Date.now() / 60_000);
  if (minute.at !== t) minute = { at: t, n: 0 };
  if (++minute.n > GLOBAL_PER_MIN) return false;
  const ip = clientIp(req);
  const day = new Date().toISOString().slice(0, 10);
  const e = perIp.get(ip);
  if (!e || e.day !== day) { perIp.set(ip, { day, n: 1 }); return true; }
  e.n += 1; return e.n <= FREE_RUNS;
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) { chunks.push(c as Buffer); if (chunks.reduce((s, x) => s + x.length, 0) > 200_000) throw new Error("body too large"); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res: ServerResponse, status: number, data: unknown, origin?: string) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ORIGINS.includes("*") ? "*" : (origin && ORIGINS.includes(origin) ? origin : ORIGINS[0]!),
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function steadySigner(): string | undefined {
  return process.env.MEMO_SIGNER_KEY ? privateKeyToAccount(process.env.MEMO_SIGNER_KEY as `0x${string}`).address : undefined;
}

async function recommendedBy(m: Signed<Advice> | undefined, wallet: string, fix: FixSpec): Promise<boolean> {
  const steady = steadySigner();
  if (!m?.body || !steady || m.signer?.toLowerCase() !== steady.toLowerCase()) return false;
  if (!(await verify(m).catch(() => false))) return false;
  if (m.body.wallet !== wallet || Date.now() - Date.parse(m.body.at) > 6 * 3600_000) return false;
  const want = canonical(fix);
  return (m.body.findings ?? []).some((f) => f.fix && canonical(f.fix) === want);
}

// GET /stats: the background work in counts, each block with the time it was read. Free, read only.
const stats = makeStats({
  fetch, now: Date.now, spend, bootedAt: new Date().toISOString(),
  ledger: () => { const l = new Ledger(); return { entries: l.load(), lines: l.lines() }; },
  node: process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com",
  minerUrl: process.env.MINER_URL ?? "https://steady-miner-production.up.railway.app",
  botUrl: process.env.BOT_STATS_URL ?? "https://steady-bot-production.up.railway.app",
});

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") return send(res, 204, {}, origin);
    if (url.pathname === "/health") return send(res, 200, { ok: true, spend: spend() }, origin);

    const guarded = await guardRoute(ctx, req, url, () => body(req), () => allow(req));
    if (guarded) return send(res, guarded.status, guarded.body, origin);

    if (req.method === "POST" && url.pathname === "/advise") {
      const { wallet } = await body(req);
      if (!isAddress(wallet)) return send(res, 400, { error: "not a Solana address" }, origin);
      if (!allow(req)) return send(res, 429, { error: `free limit of ${FREE_RUNS} checks a day reached` }, origin);
      const a = await advise(wallet, ctx);
      bump("walletChecks");
      return send(res, 200, { advice: a, memo: await sign(a) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/fix") {
      const { wallet, fix, adviceMemo } = (await body(req)) as { wallet: string; fix: FixSpec; adviceMemo?: Signed<Advice> };
      if (!isAddress(wallet) || !fix?.action) return send(res, 400, { error: "wallet and fix are required" }, origin);
      if (!allow(req)) return send(res, 429, { error: `free limit of ${FREE_RUNS} checks a day reached` }, origin);
      const p = await readPortfolio(wallet, ctx);
      const built = await buildFix(ctx, wallet, fix, p.positions);
      // Sign only a fix Steady itself recommended: it must sit in a signed advice memo for this wallet from the last 6 hours.
      const recommended = await recommendedBy(adviceMemo, wallet, fix);
      const memo = recommended && !built.unsupported
        ? await sign({ wallet, fix, recommendedIn: adviceMemo!.digest, builder: built.builder, summary: built.summary ?? null, simulation: built.simulation ?? null })
        : null;
      return send(res, 200, { built, memo, memoNote: memo ? undefined : recommended ? "not built, so nothing to sign" : "Steady signs only fixes from its own signed advice for this wallet" }, origin);
    }

    if (req.method === "POST" && url.pathname === "/presign") {
      const { wallet, transaction, history } = await body(req);
      if (!isAddress(wallet) || typeof transaction !== "string") return send(res, 400, { error: "wallet and base64 transaction are required" }, origin);
      if (!allow(req)) return send(res, 429, { error: `free limit of ${FREE_RUNS} checks a day reached` }, origin);
      const r = await presign(ctx, transaction, wallet, { history: Array.isArray(history) ? history : [] });
      bump("txChecks");
      return send(res, 200, { result: r, memo: await sign({ wallet, result: r }) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/verify") {
      // Recomputes the digest from the body and recovers the signer; valid only if both hold and the signer is Steady's key.
      const { memo } = (await body(req)) as { memo?: Signed<unknown> };
      if (!memo?.body || !memo.digest || !memo.signature || !memo.signer) return send(res, 400, { error: "memo with body, digest, signer and signature is required" }, origin);
      const steady = process.env.MEMO_SIGNER_KEY ? privateKeyToAccount(process.env.MEMO_SIGNER_KEY as `0x${string}`).address : undefined;
      const intact = await verify(memo).catch(() => false);
      const fromSteady = !!steady && memo.signer.toLowerCase() === steady.toLowerCase();
      return send(res, 200, { valid: intact && fromSteady, intact, fromSteady, steadySigner: steady }, origin);
    }

    if (req.method === "GET" && url.pathname === "/stats") return send(res, 200, await stats(), origin);

    if (req.method === "GET" && url.pathname === "/ledger") {
      const { Ledger } = await import("../ledger/store.js");
      const l = new Ledger();
      const { loadEdge, edgeSummary } = await import("../ledger/edge.js");
      const edge = loadEdge();
      return send(res, 200, { entries: l.load(), anchors: l.anchors(), edge: { ...edgeSummary(edge), loans: edge } }, origin);
    }

    return send(res, 404, { error: "routes: POST /advise, POST /fix, POST /presign, POST /verify, GET /ledger, GET /stats, GET /health" }, origin);
  } catch (e) {
    return send(res, 500, { error: scrub(String(e)).slice(0, 300) }, origin);
  }
});

const port = Number(process.env.PORT ?? 8788);
server.listen(port, () => console.log(`steady api on :${port}`));
if (process.env.LEDGER_JOBS !== "off") startLedgerJobs(ctx);
if (process.env.GUARD_JOBS !== "off") startGuardJobs(ctx);
