// Steady liquidity miner: GET /liquidity?pool=...&chain=solana answers LIQUIDITY_DEPTH_VERIFY_GENERAL
// from Solana vault balances read at one slot, priced in USD. Never returns a guessed number.
import "dotenv/config";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import type { AdapterContext } from "../engine/types.js";
import { poolLiquidity, type PoolLiquidity } from "../engine/pools/liquidity.js";
import { isSolanaChain, resolvePool } from "./pools.js";

export interface MinerDeps {
  ctx: () => AdapterContext;
  liquidity?: (ctx: AdapterContext, pool: string) => Promise<PoolLiquidity>;
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

  return async function handle(pool: string | null, chain: string | null): Promise<Reply> {
    if (!pool) return { status: 400, body: { error: "missing_param", reason: "pool is required" } };
    if (!chain) return { status: 400, body: { error: "missing_param", reason: "chain is required; this miner serves solana" } };
    if (!isSolanaChain(chain)) {
      return { status: 400, body: { error: "unsupported_chain", reason: `chain '${chain}' is not served; this miner reads Solana pools only (chain=solana)` } };
    }
    const res = resolvePool(pool);
    if (!res.ok) return { status: res.status, body: { error: res.status === 404 ? "unknown_pool" : "bad_pool", reason: res.reason } };
    const hit = cache.get(res.address);
    if (hit && clock() - hit.at < ttl) return hit.reply;
    let p = inflight.get(res.address);
    if (!p) {
      p = read(res.address, res.name)
        .then((reply) => {
          if (reply.status === 200 || reply.status === 422) {
            if (cache.size > 500) cache.clear();
            cache.set(res.address, { at: clock(), reply });
          }
          return reply;
        })
        .finally(() => inflight.delete(res.address));
      inflight.set(res.address, p);
    }
    return p;
  };
}

export function createMinerServer(deps: MinerDeps): Server {
  const handle = createHandler(deps);
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
      if (url.pathname === "/liquidity") return send(await handle(url.searchParams.get("pool"), url.searchParams.get("chain")));
      send({ status: 404, body: { error: "not_found", reason: "routes: GET /liquidity?pool=&chain=solana, GET /health" } });
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
