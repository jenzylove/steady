// Spike: do Telegraph CRYPTO_PRICE_USD miners agree on SOL and JLP, and how does that compare with Jupiter?
import "dotenv/config";
import { quorum } from "../src/telegraph/client.js";

for (const symbol of process.argv.slice(2).length ? process.argv.slice(2) : ["SOL", "JLP"]) {
  const q = await quorum<number>({
    intent: "CRYPTO_PRICE_USD",
    params: { symbol },
    extract: (r) => {
      const v = (r as any).price_usd ?? (r as any).price ?? (r as any).usd ?? (r as any).value;
      return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
    },
    valid: (v) => (v > 0 ? undefined : "not a price"),
    same: (a, b) => Math.abs(a - b) / Math.max(a, b) < 0.01,
    need: 2,
  });
  console.log(symbol, "agreed", q.agreed, q.value, "cost", q.costUsd);
  for (const a of q.answers) console.log("  ", a.role, a.status, a.used, a.value, a.rejectReason ?? "", JSON.stringify(a.result ?? a.error).slice(0, 220));
}
