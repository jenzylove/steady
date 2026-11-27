// HTTP routes and the background watcher for Steady Guard. Mounted by the API server.
import type { IncomingMessage } from "node:http";
import type { AdapterContext } from "../engine/types.js";
import { isAddress } from "../presign/check.js";
import { healthFactor } from "../engine/risk/health.js";
import { bump } from "../stats/counters.js";
import { sign } from "../memo/memo.js";
import {
  arm, findGuard, loadGuards, nonceAddress, nonceCloseTx, prepare, readKaminoLoan, readNonce, rpcFireDeps, saveGuards, tick, type Guard,
} from "./guard.js";
import { ASK_EVERY_MS, decideEarly } from "./early.js";

type Reply = { status: number; body: unknown };
const pub = (g: Guard) => { const { signedTx: _s, ...rest } = g; return { ...rest, signed: !!g.signedTx }; };

/** Handles /guard routes; returns null when the path is not a guard route. */
export async function guardRoute(ctx: AdapterContext, req: IncomingMessage, url: URL, body: () => Promise<any>, allow: () => boolean): Promise<Reply | null> {
  if (!url.pathname.startsWith("/guard")) return null;
  const gs = loadGuards();

  if (req.method === "GET" && url.pathname === "/guard") {
    const wallet = url.searchParams.get("wallet") ?? "";
    if (!isAddress(wallet)) return { status: 400, body: { error: "wallet is required" } };
    return { status: 200, body: { guards: gs.filter((g) => g.wallet === wallet).map(pub), nonceAccount: await nonceAddress(wallet) } };
  }

  if (req.method === "GET" && url.pathname === "/guard/events") {
    // For the Telegram bot: recent guard events with the wallet they belong to (addresses are public on chain).
    const after = url.searchParams.get("after") ?? "1970";
    const events = gs.flatMap((g) => g.events.filter((e) => e.at > after).map((e) => ({ wallet: g.wallet, obligation: g.obligation, line: g.line, ...e })));
    return { status: 200, body: { events: events.sort((a, b) => a.at.localeCompare(b.at)) } };
  }

  if (req.method === "POST" && url.pathname === "/guard/prepare") {
    const { wallet, obligation, line } = await body();
    if (!isAddress(wallet) || typeof obligation !== "string" || typeof line !== "number") return { status: 400, body: { error: "wallet, obligation and line are required" } };
    if (!allow()) return { status: 429, body: { error: "free daily limit reached" } };
    try {
      const r = await prepare(ctx, wallet, obligation, line, gs);
      if (r.step === "sign-rescue") { saveGuards(gs); return { status: 200, body: { step: r.step, transaction: r.transaction, guard: pub(r.guard) } }; }
      return { status: 200, body: r };
    } catch (e) { return { status: 400, body: { error: String((e as Error).message ?? e).slice(0, 300) } }; }
  }

  if (req.method === "POST" && url.pathname === "/guard/arm") {
    const { wallet, obligation, signed } = await body();
    if (!isAddress(wallet) || typeof obligation !== "string" || typeof signed !== "string") return { status: 400, body: { error: "wallet, obligation and signed are required" } };
    const g = findGuard(gs, wallet, obligation);
    if (!g || g.status !== "prepared") return { status: 404, body: { error: "no prepared rescue for this loan; prepare it first" } };
    const r = await arm(ctx, g, signed);
    if (!r.ok) return { status: 400, body: { error: r.reason } };
    saveGuards(gs); bump("guardsArmed");
    return { status: 200, body: { guard: pub(g), memo: await sign({ guard: pub(g) }) } };
  }

  if (req.method === "POST" && url.pathname === "/guard/cancel") {
    const { wallet } = await body();
    if (!isAddress(wallet)) return { status: 400, body: { error: "wallet is required" } };
    const n = await readNonce(ctx, await nonceAddress(wallet));
    if (!n) {
      for (const g of gs.filter((x) => x.wallet === wallet && (x.status === "armed" || x.status === "prepared" || x.status === "stale"))) { g.status = "cancelled"; g.events.push({ at: new Date().toISOString(), kind: "cancelled", note: "nonce account closed by the owner" }); }
      saveGuards(gs);
      return { status: 200, body: { cancelled: true } };
    }
    return { status: 200, body: { transaction: await nonceCloseTx(ctx, wallet), note: "Sign and send to close the nonce account. That cancels the signed rescue for good and returns the rent." } };
  }

  return { status: 404, body: { error: "guard routes: GET /guard?wallet=, POST /guard/prepare, POST /guard/arm, POST /guard/cancel, GET /guard/events" } };
}

/** Background watcher: every 45 seconds, check armed guards, fire at the line or early on agreed market prices. */
export function startGuardJobs(ctx: AdapterContext, everyMs = 45_000): void {
  const deps = rpcFireDeps(ctx);
  const lastAsk = new Map<string, number>();
  let running = false;
  const early = async (g: Guard, h: number): Promise<string | null> => {
    const k = `${g.wallet}:${g.obligation}`;
    if (Date.now() - (lastAsk.get(k) ?? 0) < ASK_EVERY_MS) return null;
    const { loan } = await readKaminoLoan(ctx, g.wallet, g.obligation);
    if (!loan) return null;
    const d = await decideEarly(loan, healthFactor(loan), g.line);
    if (d.checks.length) {
      lastAsk.set(k, Date.now()); bump("guardPriceChecks");
      g.lastEarly = { at: new Date().toISOString(), chainHealth: h, projected: d.projected, fire: d.fire, costUsd: d.costUsd, checks: d.checks };
    }
    if (d.fire) bump("guardEarlyFires");
    return d.fire ? d.reason ?? null : null;
  };
  setInterval(async () => {
    if (running) return; running = true;
    try {
      const gs = loadGuards();
      if (!gs.some((g) => g.status === "armed")) return;
      const changed = await tick(ctx, gs, deps, early);
      for (const g of changed) if (g.status === "fired") bump("guardRescues");
      saveGuards(gs);
    } catch (e) { console.error("guard tick", String(e).slice(0, 200)); }
    finally { running = false; }
  }, everyMs);
}
