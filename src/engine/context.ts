import "dotenv/config";
import type { AdapterContext } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch that waits and retries when a provider rate limits (HTTP 429 or 503), honouring Retry-After when given. */
export function retryingFetch(base: typeof fetch = fetch, tries = 5): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    for (let i = 0; ; i++) {
      const res = await base(input, init);
      if ((res.status !== 429 && res.status !== 503) || i >= tries) return res;
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 8000) : 500 * 2 ** i);
    }
  }) as typeof fetch;
}

export function makeContext(): AdapterContext {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return { heliusRpcUrl: `https://mainnet.helius-rpc.com/?api-key=${key}`, fetch: retryingFetch(), now: () => new Date() };
}
