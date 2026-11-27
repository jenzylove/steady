// Steady liquidity miner: GET /liquidity?pool=...&chain=solana answers LIQUIDITY_DEPTH_VERIFY_GENERAL
// from Solana vault balances read at one slot, priced in USD. Never returns a guessed number.
import "dotenv/config";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import type { AdapterContext } from "../engine/types.js";
import { poolLiquidity, type PoolLiquidity } from "../engine/pools/liquidity.js";
import { isSolanaChain, parseAsk, resolvePool } from "./pools.js";
import { discoverPools, TOKEN_MINTS, tokenMint } from "./discover.js";

export interface MinerDeps {
  ctx: () => AdapterContext;
  liquidity?: (ctx: AdapterContext, pool: string) => Promise<PoolLiquidity>;
  /** Pool addresses holding all the given mints, deepest first. Defaults to DexScreener's public pair list. */
  discover?: (mints: string[], dex: string | undefined) => Promise<string[]>;
  cacheMs?: number;
  now?: () => number;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function shape(r: PoolLiquidity, chain: string, name: string | undefined, fetchedAt: string) {
  const slot = r.sources.find((s) => s.kind === "chain")?.slot ?? null;
  const price = (usd: number | null, amount: number) => (usd != null && amount > 0 ? usd / amount : null);
  return {
    pool: r.pool,
    pool_address: r.pool,
    pool_name: name ?? `${r.tokenA.symbol}/${r.tokenB.symbol}`,
    chain,
    dex: r.dex,
    liquidity_usd: round6(r.usd as number),
    token_a: { mint: r.tokenA.mint, symbol: r.tokenA.symbol },
    token_b: { mint: r.tokenB.mint, symbol: r.tokenB.symbol },
    amount_a: r.tokenA.amount,
    amount_b: r.tokenB.amount,
    price_a: price(r.tokenA.usd, r.tokenA.amount),
    price_b: price(r.tokenB.usd, r.tokenB.amount),
    slot,
    sources: r.sources,
    answer: `${name ?? r.pool} on Solana holds ${r.tokenA.amount} ${r.tokenA.symbol} and ${r.tokenB.amount} ${r.tokenB.symbol} in its vaults at slot ${slot}, worth ${round6(r.usd as number)} USD in total.`,
    fetched_at: fetchedAt,
  };
}

export function createHandler(deps: MinerDeps) {
  const liquidity = deps.liquidity ?? poolLiquidity;
  const discover = deps.discover ?? ((m: string[], d: string | undefined) => discoverPools(m, d));
  const ttl = deps.cacheMs ?? 30_000;
  const clock = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; reply: Reply }>();
  const inflight = new Map<string, Promise<Reply>>();

  async function read(address: string, name: string | undefined): Promise<Reply> {
    let r: PoolLiquidity;
    try {
      r = await liquidity(deps.ctx(), address);
    } catch (e) {
      const msg = String((e as Error).message ?? e).replace(/api-key=[^&\s"']+/g, "api-key=REDACTED");
      if (/not found/.test(msg)) return { status: 404, body: { error: "pool_not_found", reason: `no account at ${address} on Solana mainnet` } };
      if (/not an Orca, Raydium or Meteora pool/.test(msg)) {
        return { status: 400, body: { error: "unsupported_pool", reason: "that account is not an Orca Whirlpool, Raydium (AMM v4, CLMM, CPMM) or Meteora DLMM pool" } };
      }
      return { status: 502, body: { error: "upstream_error", reason: msg } };
    }
    if (r.usd == null) {
      return { status: 422, body: { error: "unpriced_token", reason: r.gaps.join("; ") || "a token of the pool has no USD price", pool: address } };
    }
    return { status: 200, body: shape(r, "solana", name, new Date(clock()).toISOString()) };
  }

  /** Reads a pool through the 30 second cache, sharing one in flight read per address. */
  function cached(address: string, name: string | undefined): Promise<Reply> {
    const hit = cache.get(address);
    if (hit && clock() - hit.at < ttl) return Promise.resolve(hit.reply);
    let p = inflight.get(address);
    if (!p) {
      p = read(address, name)
        .then((reply) => {
          if (reply.status === 200 || reply.status === 422) {
            if (cache.size > 500) cache.clear();
            cache.set(address, { at: clock(), reply });
          }
          return reply;
        })
        .finally(() => inflight.delete(address));
      inflight.set(address, p);
    }
    return p;
  }

  /** A name the table does not know: look the pair up live and answer with the deepest pool that can be read. */
  async function byPair(pool: string): Promise<Reply | null> {
    const ask = parseAsk(pool);
    if (ask.fee || ask.tokens.length < 1 || ask.tokens.length > 2) return null;
    const mints = ask.tokens.map(tokenMint);
    if (mints.some((m) => !m)) {
      const bad = ask.tokens.filter((_, i) => !mints[i]).map((b) => `'${b}'`).join(", ");
      return { status: 404, body: { error: "unknown_pool", reason: `unknown token ${bad}; use one of ${Object.keys(TOKEN_MINTS).join(", ")}, a token mint address, or the pool address` } };
    }
    const found = await discover(mints as string[], ask.dex).catch(() => [] as string[]);
    for (const address of found) {
      const r = await cached(address, undefined);
      if (r.status === 200 || r.status === 422) return r;
    }
    return { status: 404, body: { error: "unknown_pool", reason: `no readable Orca, Raydium or Meteora pool found for '${pool}'; pass the pool address` } };
  }

  return async function handle(pool: string | null, chain: string | null): Promise<Reply> {
    if (!pool) return { status: 400, body: { error: "missing_param", reason: "pool is required" } };
    if (!chain) return { status: 400, body: { error: "missing_param", reason: "chain is required; this miner serves solana" } };
    if (!isSolanaChain(chain)) {
      return { status: 400, body: { error: "unsupported_chain", reason: `chain '${chain}' is not served; this miner reads Solana pools only (chain=solana)` } };
    }
    const res = resolvePool(pool);
    if (res.ok) return cached(res.address, res.name);
    // Not in the table, or a bare pair that matches several pools.
    if (res.status === 404 || /more than one pool/.test(res.reason)) {
      const live = await byPair(pool);
      if (live) return live;
    }
    return { status: res.status, body: { error: res.status === 404 ? "unknown_pool" : "bad_pool", reason: res.reason } };
  };
}

/** Counts since this process started. Reads from Steady's own site send x-steady-board and are counted apart. */
export interface MinerStats { since: string; answers: number; refused: number; boardReads: number; lastAnswerAt: string | null; refusedBy: Record<string, number>; recentRefused: { at: string; pool: string; chain: string; status: number; error: string }[] }

export function createMinerServer(deps: MinerDeps): Server {
  const handle = createHandler(deps);
  const clock = deps.now ?? Date.now;
  const stats: MinerStats = { since: new Date(clock()).toISOString(), answers: 0, refused: 0, boardReads: 0, lastAnswerAt: null, refusedBy: {}, recentRefused: [] };
  const perIp = new Map<string, { minute: number; n: number }>();
  const PER_IP_PER_MIN = Number(process.env.MINER_PER_IP_PER_MIN ?? "240");
  return createServer(async (req, res) => {
    const send = (r: Reply) => {
      res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(r.body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method !== "GET") return send({ status: 405, body: { error: "method_not_allowed", reason: "GET only" } });
      if (url.pathname === "/health") return send({ status: 200, body: { status: "ok", service: "steady-liquidity-miner" } });
      if (url.pathname === "/steady-liquidity.yaml") {
        // Serve the exact bytes committed in the repo; the registry stores their SHA-256.
        const { readFile } = await import("node:fs/promises");
        const bytes = await readFile(new URL("../../miner/steady-liquidity.yaml", import.meta.url));
        res.writeHead(200, { "content-type": "text/yaml; charset=utf-8" });
        return void res.end(bytes);
      }
      if (url.pathname === "/stats") return send({ status: 200, body: { ...stats } });
      if (url.pathname === "/liquidity") {
        // Generous per IP ceiling: Telegraph's node and the web board stay far below it; a script hammering uncached pools does not.
        const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? "?";
        const minute = Math.floor(clock() / 60_000);
        const seen = perIp.get(ip);
        if (!seen || seen.minute !== minute) perIp.set(ip, { minute, n: 1 });
        else if (++seen.n > PER_IP_PER_MIN) return send({ status: 429, body: { error: "rate_limited", reason: `more than ${PER_IP_PER_MIN} requests a minute from one address` } });
        if (perIp.size > 5000) perIp.clear();
        const r = await handle(url.searchParams.get("pool"), url.searchParams.get("chain"));
        if (req.headers["x-steady-board"]) stats.boardReads++;
        else if (r.status === 200) { stats.answers++; stats.lastAnswerAt = new Date(clock()).toISOString(); }
        else {
          stats.refused++;
          const err = String((r.body as { error?: unknown }).error ?? r.status);
          stats.refusedBy[err] = (stats.refusedBy[err] ?? 0) + 1;
          stats.recentRefused.push({ at: new Date(clock()).toISOString(), pool: String(url.searchParams.get("pool") ?? "").slice(0, 80), chain: String(url.searchParams.get("chain") ?? "").slice(0, 24), status: r.status, error: err });
          if (stats.recentRefused.length > 60) stats.recentRefused.shift();
        }
        return send(r);
      }
      send({ status: 404, body: { error: "not_found", reason: "routes: GET /liquidity?pool=&chain=solana, GET /stats, GET /health" } });
    } catch (e) {
      send({ status: 500, body: { error: "internal", reason: String((e as Error).message ?? e).slice(0, 200) } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { makeContext } = await import("../engine/context.js");
  const ctx = makeContext();
  const port = Number(process.env.PORT ?? 8787);
  createMinerServer({ ctx: () => ctx }).listen(port, () => console.log(`steady liquidity miner on :${port}`));
}
