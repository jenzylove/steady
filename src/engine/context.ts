import "dotenv/config";
import type { AdapterContext } from "./types.js";

export function makeContext(): AdapterContext {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return { heliusRpcUrl: `https://mainnet.helius-rpc.com/?api-key=${key}`, fetch, now: () => new Date() };
}
