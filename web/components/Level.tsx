"use client";
// A spirit level gauge. `pos` 0 means the bubble is pinned to the danger end, 1 means it is centred (safe).
export default function Level({ pos, height = 46, danger = "Liquidation", safe = "Safe", showLabels = true }: { pos: number; height?: number; danger?: string; safe?: string; showLabels?: boolean }) {
  const p = Math.max(0, Math.min(1, pos));
  const left = 4 + p * 46; // percent of the vial width where the bubble's left edge sits (centre at 50)
  const tone = p < 0.35 ? "var(--risk)" : p < 0.65 ? "var(--warn)" : "var(--vial)";
  return (
    <div style={{ width: "100%" }}>
      <div style={{ position: "relative", height, borderRadius: height, background: "var(--vial-glass)", boxShadow: "inset 0 0 0 1.5px var(--line2), inset 0 6px 14px -8px rgba(0,0,0,.35)", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "18%", background: "linear-gradient(90deg, color-mix(in srgb, var(--risk) 30%, transparent), transparent)" }} />
        {[34, 66].map((x) => (
          <div key={x} style={{ position: "absolute", left: `${x}%`, top: "18%", bottom: "18%", width: 1.5, background: "var(--line2)" }} />
        ))}
        <div
          style={{
            position: "absolute", top: "50%", left: `${left}%`, width: "28%", height: height * 0.58, transform: "translateY(-50%)", borderRadius: height,
            background: `radial-gradient(120% 140% at 35% 25%, rgba(255,255,255,.65), ${tone} 45%, color-mix(in srgb, ${tone} 70%, black))`,
            boxShadow: `0 0 24px -4px ${tone}`,
            transition: "left 1.6s cubic-bezier(.25,1.4,.35,1), background .6s",
          }}
        />
      </div>
      {showLabels && (
        <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mute)", marginTop: 8, letterSpacing: ".08em", textTransform: "uppercase" }}>
          <span>{danger}</span>
          <span>{safe}</span>
        </div>
      )}
    </div>
  );
}

/** Map a distance to liquidation (percent price drop) onto the level: 0% is the edge, 40% or more is centred. */
export const levelFromDistance = (pct: number) => Math.max(0, Math.min(1, pct / 40));
