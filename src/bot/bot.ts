// Steady Telegram bot: long polling over fetch, no framework. Read only; never asks for keys.
import { advise } from "../engine/advice/advise.js";
import type { Advice } from "../engine/advice/types.js";
import type { AdapterContext } from "../engine/types.js";
import { formatAlert, formatReport } from "./report.js";
import { addWallet, diffFindings, isAlertable, loadWatch, removeWallet, saveWatch, type WatchState } from "./watch.js";

const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function isSolanaAddress(s: string): boolean { return s.length >= 32 && s.length <= 44 && B58.test(s); }

/** True for text that looks like a seed phrase or a private key. Never stored, never echoed. */
export function looksLikeSecret(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]{3,8}$/.test(w))) return true;
  if (t.length >= 64 && t.length <= 100 && !/\s/.test(t) && B58.test(t)) return true; // base58 secret key
  if (/^\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,}\s*\]$/.test(t)) return true; // keypair json array
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) return true;
  return false;
}

export const WELCOME = "<b>Steady</b> watches your Solana wallet for loans near liquidation, depegs, risky approvals and idle money, and prepares the fix for you to sign in Phantom.\n\nRead only. Steady never asks for keys or seed phrases. Send /watch &lt;address&gt; to start, or paste an address for a one off check.";
export const HELP = "/watch &lt;address&gt; add a wallet and get a report\n/unwatch &lt;address&gt; stop watching\n/list wallets you watch\n/check &lt;address&gt; one off report\n/help this message\n\nYou can also paste an address to check it. Never send a seed phrase or private key.";
export const SECRET_WARNING = "That looks like a seed phrase or private key. I did not store it. Never share it with anyone, including me. If it is real, move your funds to a new wallet now. Steady only needs a public address.";

export class Tg {
  constructor(private token: string, private f: typeof fetch = fetch) {}
  async call<T = any>(method: string, body: object = {}): Promise<T> {
    const res = await this.f(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description ?? res.status}`);
    return j.result;
  }
  send(chatId: string | number, text: string) {
    return this.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
  }
}

export interface BotDeps { tg: Tg; ctx: AdapterContext; state: WatchState; save: () => void; run?: (w: string, o?: { telegraph?: boolean }) => Promise<Advice> }

export async function handleText(d: BotDeps, chat: string, text: string): Promise<void> {
  const run = d.run ?? ((w, o) => advise(w, d.ctx, o));
  const t = text.trim();
  if (looksLikeSecret(t)) { await d.tg.send(chat, SECRET_WARNING); return; }
  const [cmdRaw, ...rest] = t.split(/\s+/);
  const cmd = cmdRaw!.startsWith("/") ? cmdRaw!.split("@")[0]!.toLowerCase() : "";
  const arg = rest[0] ?? "";
  const report = async (addr: string) => {
    if (!isSolanaAddress(addr)) { await d.tg.send(chat, "That is not a Solana address."); return; }
    await d.tg.send(chat, "Reading the wallet, one moment.");
    try { await d.tg.send(chat, formatReport(await run(addr))); }
    catch (e) { await d.tg.send(chat, "Could not read that wallet right now. Try again in a minute."); console.error("advise failed", String(e).slice(0, 120)); }
  };
  if (cmd === "/start") { await d.tg.send(chat, WELCOME); return; }
  if (cmd === "/help") { await d.tg.send(chat, HELP); return; }
  if (cmd === "/list") {
    const l = d.state[chat] ?? [];
    await d.tg.send(chat, l.length ? l.map((w) => `<code>${w.address}</code>`).join("\n") : "You are not watching any wallets. Use /watch &lt;address&gt;.");
    return;
  }
  if (cmd === "/watch") {
    if (!isSolanaAddress(arg)) { await d.tg.send(chat, "Usage: /watch &lt;solana address&gt;"); return; }
    const added = addWallet(d.state, chat, arg);
    d.save();
    await d.tg.send(chat, added ? "Watching. I will message you only when something serious appears or gets worse." : "Already watching that wallet.");
    try {
      const a = await run(arg);
      const w = d.state[chat]?.find((x) => x.address === arg);
      if (w) { w.seen = diffFindings({}, a.findings).seen; d.save(); } // baseline so the first heartbeat does not repeat this report
      await d.tg.send(chat, formatReport(a));
    } catch (e) { await d.tg.send(chat, "Could not read that wallet right now. I will keep trying."); console.error("advise failed", String(e).slice(0, 120)); }
    return;
  }
  if (cmd === "/unwatch") {
    if (!isSolanaAddress(arg)) { await d.tg.send(chat, "Usage: /unwatch &lt;solana address&gt;"); return; }
    const ok = removeWallet(d.state, chat, arg); d.save();
    await d.tg.send(chat, ok ? "Stopped watching." : "You were not watching that wallet.");
    return;
  }
  if (cmd === "/check") { await report(arg); return; }
  if (!cmd && isSolanaAddress(t)) { await report(t); return; }
  if (cmd) await d.tg.send(chat, "Unknown command. Try /help.");
}

/** One heartbeat pass. Cheap run first (no paid Telegraph calls); a second verified run only when a high or critical finding exists. */
export async function heartbeat(d: BotDeps): Promise<void> {
  const run = d.run ?? ((w, o) => advise(w, d.ctx, o));
  for (const [chat, wallets] of Object.entries(d.state)) {
    for (const w of wallets) {
      try {
        let a = await run(w.address, { telegraph: false });
        if (a.findings.some((f) => isAlertable(f.severity))) a = await run(w.address, { telegraph: true });
        const diff = diffFindings(w.seen, a.findings);
        w.seen = diff.seen;
        d.save();
        if (diff.alerts.length) await d.tg.send(chat, formatAlert(w.address, diff.alerts));
      } catch (e) { console.error("heartbeat failed", w.address.slice(0, 4), String(e).slice(0, 120)); }
    }
  }
}

export async function startBot(token: string, ctx: AdapterContext): Promise<void> {
  const tg = new Tg(token);
  const state = loadWatch();
  const d: BotDeps = { tg, ctx, state, save: () => saveWatch(state) };
  const me = await tg.call<{ username: string }>("getMe");
  console.log(`bot @${me.username} polling`);
  const mins = Number(process.env.WATCH_INTERVAL_MIN) || 15;
  let beating = false;
  setInterval(() => { if (beating) return; beating = true; heartbeat(d).finally(() => { beating = false; }); }, mins * 60_000);
  let offset = 0;
  for (;;) {
    try {
      const ups = await tg.call<any[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
      for (const u of ups) {
        offset = u.update_id + 1;
        const m = u.message;
        if (m?.text && m.chat?.id != null) handleText(d, String(m.chat.id), m.text).catch((e) => console.error("handler failed", String(e).slice(0, 120)));
      }
    } catch (e) { console.error("poll failed", String(e).slice(0, 120)); await new Promise((r) => setTimeout(r, 3000)); }
  }
}
