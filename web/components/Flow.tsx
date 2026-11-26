"use client";
import { useEffect, useRef, useState } from "react";

const NODES = [
  { t: "Your wallet", d: "Paste an address. Looking needs no connection and no signature." },
  { t: "Chain reads", d: "Tokens, staked SOL, loans on Kamino, marginfi and Save, LP on Orca, Raydium and Meteora, perps on Drift and Jupiter. Read from mainnet itself." },
  { t: "Telegraph miners", d: "Independent miners answer what the chain cannot know, like protocol news and sanctions lists. A lending rate goes to several miners in roles." },
  { t: "Signed memo", d: "Every number, every source and every miner answer, used or rejected, sealed in one signed memo." },
  { t: "The fix you sign", d: "Steady builds the transaction for your wallet, simulates it on mainnet, and Phantom asks you to approve." },
  { t: "It keeps watching", d: "Hand the wallet to the Telegram bot. It rereads it every 15 minutes and messages you only when a risk is new or gets worse, with the fix ready." },
];

function Glyph({ k }: { k: number }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  switch (k) {
    case 0: return <svg viewBox="0 0 40 40" width="40" height="40"><rect x="7" y="11" width="26" height="19" rx="3" {...s} /><path d="M25 18h8v6h-8a3 3 0 0 1 0-6z" {...s} /></svg>;
    case 1: return <svg viewBox="0 0 40 40" width="40" height="40">{[0, 1, 2].map((r) => <rect key={r} x="8" y={9 + r * 8} width="24" height="5" rx="1" {...s} />)}</svg>;
    case 2: return <svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="11" r="4" {...s} /><circle cx="10" cy="28" r="4" {...s} /><circle cx="30" cy="28" r="4" {...s} /><path d="M17 14l-5 10M23 14l5 10M14 28h12" {...s} /></svg>;
    case 3: return <svg viewBox="0 0 40 40" width="40" height="40"><path d="M11 7h13l6 6v20H11z" {...s} /><path d="M15 18h11M15 23h11" {...s} /><circle cx="25" cy="29" r="3.5" fill="var(--vial)" stroke="none" /></svg>;
    case 4: return <svg viewBox="0 0 40 40" width="40" height="40"><path d="M9 21l7 7 15-16" {...s} strokeWidth={2.2} /></svg>;
    default: return <svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="12" {...s} /><path d="M20 13v7l5 3" {...s} /></svg>;
  }
}

export default function Flow() {
  const ref = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(-1);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !timer) {
        let k = 0; setLit(0);
        timer = setInterval(() => { k = (k + 1) % 8; setLit(k > 5 ? 5 : k); if (k === 7) { k = -1; } }, 1500);
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); if (timer) clearInterval(timer); };
  }, []);
  return (
    <div ref={ref} className="flow">
      <ol className="flow-nodes">
        {NODES.map((n, k) => (
          <li key={n.t} className={`${k <= lit ? "on" : ""} ${k < lit ? "done" : ""}`}>
            <div className="flow-dot"><Glyph k={k} /></div>
            <div className="flow-t">
              <span className="mono mute" style={{ fontSize: 12 }}>0{k + 1}</span>
              <h3 className="display">{n.t}</h3>
            </div>
            <div className="flow-d">
              <p className="ink2">{n.d}</p>
              {k === 2 && (
                <ul className="roles">
                  <li><span className="tag vial">Answer</span> one miner gives the fact</li>
                  <li><span className="tag vial">Verify</span> a second checks it</li>
                  <li><span className="tag">Compare</span> a third against the chain</li>
                  <li className="rejected"><span className="tag risk">Rejected</span> <span className="strike">marginfi pays 330% on USDC</span></li>
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
