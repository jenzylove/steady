// Steady API: advice, fix building, check before signing, ledger, miner status. Read only on Solana; never signs or sends.
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeContext } from "../engine/context.js";
import { readPortfolio } from "../engine/portfolio.js";
import { advise } from "../engine/advice/advise.js";
import { buildFix } from "../fix/build.js";
import { presign, isAddress } from "../presign/check.js";
import { sign, verify, type Signed } from "../memo/memo.js";
import { privateKeyToAccount } from "viem/accounts";
import { spend } from "../telegraph/client.js";
import type { FixSpec } from "../engine/advice/types.js";
import { startLedgerJobs } from "../ledger/jobs.js";

const ctx = makeContext();
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",");
const perIp = new Map<string, { day: string; n: number }>();
const FREE_RUNS = Number(process.env.FREE_RUNS_PER_DAY ?? "20");

function allow(req: IncomingMessage): boolean {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0]!.trim();
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

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") return send(res, 204, {}, origin);
    if (url.pathname === "/health") return send(res, 200, { ok: true, spend: spend() }, origin);

    if (req.method === "POST" && url.pathname === "/advise") {
      const { wallet } = await body(req);
      if (!isAddress(wallet)) return send(res, 400, { error: "not a Solana address" }, origin);
      if (!allow(req)) return send(res, 429, { error: `free limit of ${FREE_RUNS} checks a day reached` }, origin);
      const a = await advise(wallet, ctx);
      return send(res, 200, { advice: a, memo: await sign(a) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/fix") {
      const { wallet, fix } = (await body(req)) as { wallet: string; fix: FixSpec };
      if (!isAddress(wallet) || !fix?.action) return send(res, 400, { error: "wallet and fix are required" }, origin);
      const p = await readPortfolio(wallet, ctx);
      const built = await buildFix(ctx, wallet, fix, p.positions);
      return send(res, 200, { built, memo: await sign({ wallet, fix, builder: built.builder, summary: built.summary ?? null, simulation: built.simulation ?? null, unsupported: built.unsupported ?? null }) }, origin);
    }

    if (req.method === "POST" && url.pathname === "/presign") {
      const { wallet, transaction, history } = await body(req);
      if (!isAddress(wallet) || typeof transaction !== "string") return send(res, 400, { error: "wallet and base64 transaction are required" }, origin);
      if (!allow(req)) return send(res, 429, { error: `free limit of ${FREE_RUNS} checks a day reached` }, origin);
      const r = await presign(ctx, transaction, wallet, { history: Array.isArray(history) ? history : [] });
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

    if (req.method === "GET" && url.pathname === "/ledger") {
      const { Ledger } = await import("../ledger/store.js");
      return send(res, 200, { entries: new Ledger().load() }, origin);
    }

    return send(res, 404, { error: "routes: POST /advise, POST /fix, POST /presign, POST /verify, GET /ledger, GET /health" }, origin);
  } catch (e) {
    return send(res, 500, { error: String(e).slice(0, 300) }, origin);
  }
});

const port = Number(process.env.PORT ?? 8788);
server.listen(port, () => console.log(`steady api on :${port}`));
if (process.env.LEDGER_JOBS !== "off") startLedgerJobs(ctx);
