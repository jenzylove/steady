"use client";
import { useEffect, useState } from "react";
import Level from "./Level";

// Every figure here is from a real Steady run on public wallet 44tD…CaS (Nov 26 2026, Solana mainnet).
const STEPS = [
  { at: 0, label: "Read", line: "Reading 44tD…CaS from Solana mainnet", pos: 0.55, health: null as number | null },
  { at: 1, label: "Found", line: "A Kamino loan: $61.92 borrowed against $82.77 of JLP", pos: 0.3, health: 1.14 },
  { at: 2, label: "Measured", line: "It liquidates if JLP falls to $3.20. That is 12% away.", pos: 0.3, health: 1.14 },
  { at: 3, label: "Checked", line: "Kamino shows the same health. A miner's news answer was not exact, so it was struck out.", pos: 0.3, health: 1.14 },
  { at: 4, label: "Fixed", line: "Repay 15.04 USDT. Simulated on mainnet, then signed in Phantom.", pos: 0.84, health: 1.5 },
];

export default function HeroDemo() {
  const [i, setI] = useState(0);
  const [h, setH] = useState(1.14);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % (STEPS.length + 1)), 2600);
    return () => clearInterval(t);
  }, []);
  const step = STEPS[Math.min(i, STEPS.length - 1)]!;
  useEffect(() => {
    if (step.health == null) return;
    const from = h, to = step.health, start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1400);
      setH(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.health, i]);

  const fixed = step.at === 4;
  return (
    <div className="hero-demo" aria-label="A real Steady run, replayed">
      <div className="hd-top">
        <span className="kicker" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><span className="live-dot" /> A real run, replayed</span>
        <span className="kicker">Kamino loan 3rvE…L1W</span>
      </div>

      <div className="hd-stage">
        <div className="hd-health">
          <span className="kicker">Health</span>
          <span className="num-xl" style={{ color: fixed ? "var(--vial-ink)" : step.health ? "var(--risk)" : "var(--mute)", transition: "color .6s" }}>
            {step.health == null ? "…" : h.toFixed(2)}
          </span>
          <span className="mute" style={{ fontSize: 13 }}>{fixed ? "after the fix" : "liquidation at 1.00"}</span>
        </div>
        <div className="hd-level">
          <Level pos={step.pos} height={64} danger="Liquidated" safe="Steady" />
          <p key={i} className="hd-line">{step.line}</p>
        </div>
      </div>

      <div className="hd-checks">
        <div className={`hd-check ${step.at >= 3 ? "on" : ""}`}>
          <span className="tag vial">Chain</span>
          <span>Steady says 1.1370. Kamino&apos;s own number: 1.1371</span>
        </div>
        <div className={`hd-check ${step.at >= 3 ? "on" : ""}`} style={{ transitionDelay: ".25s" }}>
          <span className="tag risk">Rejected</span>
          <span><span className="strike">VeriReceipt news answer</span> <span className="mute">not an exact answer</span></span>
        </div>
        <div className={`hd-check ${step.at >= 4 ? "on" : ""}`} style={{ transitionDelay: ".1s" }}>
          <span className="tag solid">Signed</span>
          <span className="mono" style={{ fontSize: 13 }}>memo b6b0…293c</span>
        </div>
      </div>

      <ol className="hd-track">
        {STEPS.map((s, k) => (
          <li key={s.label} className={k <= Math.min(i, STEPS.length - 1) ? "on" : ""}><span className="mono">0{k + 1}</span> {s.label}</li>
        ))}
      </ol>
    </div>
  );
}
