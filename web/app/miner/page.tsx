"use client";
import { useState } from "react";
import { MINER_BASE } from "@/lib/api";
import { short, usd } from "@/lib/format";

const POOLS = ["Orca SOL/USDC", "Raydium SOL/USDC 0.25%", "Meteora SOL/USDC 0.1%", "Orca SOL/JITOSOL", "Orca CBBTC/USDC", "Raydium SOL/USDC 0.04%"];

const ERRORS: Record<string, string> = {
  unsupported_chain: "The miner only answers for Solana.",
  missing_param: "Give it a pool name or address.",
  bad_pool: "That pool name is unclear or is not a Solana address.",
  unsupported_pool: "That account is not an Orca, Raydium or Meteora pool.",
  unknown_pool: "The miner does not know that name. Try an address, or one of the names above.",
  pool_not_found: "No account exists at that address.",
  unpriced_token: "One of the pool's tokens has no price, so the miner refuses to guess a dollar figure.",
  upstream_error: "The chain or the price source did not answer. Try again in a moment.",
  unreachable: "The miner did not answer.",
};

interface Answer {
  pool_name?: string; pool_address: string; dex: string; liquidity_usd: number; slot: number; answer: string; fetched_at: string;
  token_a: { symbol?: string; mint: string }; token_b: { symbol?: string; mint: string }; amount_a: number; amount_b: number; price_a: number; price_b: number;
}

export default function MinerPage() {
  const [pool, setPool] = useState("Orca SOL/USDC");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ status: number; ms: number; body: any } | null>(null);

  const ask = async (p = pool) => {
    setPool(p); setBusy(true); setRes(null);
    try { setRes(await (await fetch(`/api/miner?pool=${encodeURIComponent(p.trim())}&chain=solana`)).json()); }
    catch { setRes({ status: 0, ms: 0, body: { error: "unreachable" } }); }
    finally { setBusy(false); }
  };
  const a: Answer | null = res?.status === 200 ? res.body : null;
  const errCode: string | undefined = res && res.status !== 200 ? res.body?.error : undefined;

  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="kicker">Telegraph miner 6203</span>
        <h1 className="display page-title">How deep is this pool, really?</h1>
        <p className="ink2 big">Steady&apos;s miner answers one question for any app on Telegraph: how many dollars sit in a Solana pool right now. It reads the pool&apos;s own vaults on Orca, Raydium or Meteora, prices them, and says which slot it read. No third party index in between.</p>
      </div>

      <div style={{ maxWidth: 900 }}>
        <form className="door" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <input value={pool} onChange={(e) => setPool(e.target.value)} placeholder="Pool name or address" aria-label="Pool" spellCheck={false} />
          <button className="btn" type="submit" disabled={busy}><span className="bub" /> {busy ? "Reading the chain" : "Ask the miner"}</button>
        </form>
        <div className="chips">{POOLS.map((p) => <button key={p} className={`chip ${pool === p ? "on" : ""}`} onClick={() => ask(p)}>{p}</button>)}</div>
      </div>

      <div style={{ marginTop: 70, minHeight: 220 }}>
        {busy && <p className="mute"><span className="live-dot" /> Asking the live miner. It reads the vaults and prices them, usually in a second or two.</p>}
        {a && (
          <div className="settle-in">
            <span className="kicker">{a.pool_name ?? short(a.pool_address, 6, 6)} on {a.dex}</span>
            <p className="num-xl" style={{ fontSize: "clamp(56px, 11vw, 150px)", margin: "10px 0 18px" }}>{usd(a.liquidity_usd, 0)}</p>
            <p className="big ink2" style={{ maxWidth: 820 }}>{a.answer}</p>
            <dl className="facts" style={{ marginTop: 40, maxWidth: 900 }}>
              <dt>{a.token_a.symbol ?? short(a.token_a.mint)} in the vault</dt><dd>{a.amount_a.toLocaleString("en-US", { maximumFractionDigits: 2 })} at {usd(a.price_a, 4)}</dd>
              <dt>{a.token_b.symbol ?? short(a.token_b.mint)} in the vault</dt><dd>{a.amount_b.toLocaleString("en-US", { maximumFractionDigits: 2 })} at {usd(a.price_b, 4)}</dd>
              <dt>Read at slot</dt><dd>{a.slot.toLocaleString("en-US")}</dd>
              <dt>Pool address</dt><dd><a className="hash" href={`https://solscan.io/account/${a.pool_address}`} target="_blank" rel="noreferrer">{a.pool_address}</a></dd>
              <dt>Answered in</dt><dd>{(res!.ms / 1000).toFixed(1)} s</dd>
            </dl>
          </div>
        )}
        {res && !a && (
          <div>
            <span className="tag risk">No answer</span>
            <p className="big" style={{ marginTop: 14 }}>{ERRORS[errCode ?? ""] ?? "The miner could not answer that."}</p>
            {res.body?.reason && <p className="mute mono" style={{ fontSize: 13, marginTop: 8 }}>{String(res.body.reason).slice(0, 300)}</p>}
            <p className="mute" style={{ fontSize: 14, marginTop: 10 }}>The miner refuses rather than guess. That is on purpose.</p>
          </div>
        )}
        {!res && !busy && <p className="mute">Pick a pool above, or paste any Orca, Raydium or Meteora pool address.</p>}
      </div>

      <section className="sec" style={{ marginTop: 60 }}>
        <div className="two" style={{ marginTop: 0 }}>
          <div>
            <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginBottom: 16 }}>Checked against each DEX</h2>
            <p className="ink2" style={{ marginBottom: 20 }}>Answers compared with each exchange&apos;s own figure, fetched right after, on Nov 26 2026.</p>
            <table className="plain">
              <thead><tr><th>Pool</th><th>Miner</th><th>DEX&apos;s own</th><th>Gap</th></tr></thead>
              <tbody className="mono">
                <tr><td>Orca SOL/USDC</td><td>$17,911,664</td><td>$17,914,004</td><td>0.01%</td></tr>
                <tr><td>Raydium SOL/USDC</td><td>$14,479,106</td><td>$14,476,070</td><td>0.02%</td></tr>
                <tr><td>Meteora SOL/USDC</td><td>$2,405,682</td><td>$2,402,832</td><td>0.12%</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginBottom: 16 }}>Call it yourself</h2>
            <dl className="facts">
              <dt>Registration</dt><dd>6203</dd>
              <dt>Answers</dt><dd>LIQUIDITY_DEPTH_VERIFY_GENERAL</dd>
              <dt>Live at</dt><dd>{MINER_BASE}</dd>
              <dt>Request</dt><dd>GET /liquidity?pool=&lt;name or address&gt;&amp;chain=solana</dd>
              <dt>Returns</dt><dd>liquidity_usd, vault amounts, prices, slot, sources</dd>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
