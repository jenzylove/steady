"use client";
import { useEffect, useState } from "react";
import { usd } from "@/lib/format";

export default function MinerLive() {
  const [d, setD] = useState<{ usd: number; name: string; slot: number } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/miner?pool=" + encodeURIComponent("Orca SOL/USDC") + "&chain=solana")
      .then((r) => r.json())
      .then((j) => (j.status === 200 ? setD({ usd: j.body.liquidity_usd, name: j.body.pool_name, slot: j.body.slot }) : setErr(j.body?.reason ?? j.body?.error ?? "no answer")))
      .catch(() => setErr("the miner did not answer"));
  }, []);
  return (
    <div className="miner-live">
      <span className="kicker" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><span className="live-dot" /> Asked the miner just now</span>
      {d ? (
        <>
          <span className="num-xl">{usd(d.usd)}</span>
          <span className="ink2">sits in {d.name}, read from the pool&apos;s own vaults at slot <span className="mono">{d.slot.toLocaleString("en-US")}</span>.</span>
        </>
      ) : err ? (
        <span className="ink2">The live read did not come back ({err}).</span>
      ) : (
        <span className="num-xl mute">…</span>
      )}
    </div>
  );
}
