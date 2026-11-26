import { makeContext } from "../src/engine/context.js";
import { buildFix } from "../src/fix/build.js";
import { presign } from "../src/presign/check.js";
const W = process.argv[2]!; const ctx = makeContext();
// Build a real Jupiter swap for the wallet (0.001 SOL to USDC) and check it before signing.
const b = await buildFix(ctx, W, { action: "swap", protocol: "jupiter", mintIn: "So11111111111111111111111111111111111111112", mintOut: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: 0.001, reason: "test" }, []);
if (!b.transaction) { console.log(b.unsupported); process.exit(1); }
const r = await presign(ctx, b.transaction, W, { telegraph: false });
console.log(JSON.stringify({ verdict: r.verdict, reasons: r.reasons, changes: r.signerChanges, programs: r.programs }, null, 1));
