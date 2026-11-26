// The mark is a level vial seen from above: the bubble sits dead centre between the two graduations.
export function Mark({ size = 30, still = false }: { size?: number; still?: boolean }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 60 30" aria-hidden="true" className={still ? "" : "mark"}>
      <rect x="1.5" y="3" width="57" height="24" rx="12" fill="none" stroke="currentColor" strokeWidth="3" />
      <line x1="20" y1="8" x2="20" y2="22" stroke="currentColor" strokeWidth="2" />
      <line x1="40" y1="8" x2="40" y2="22" stroke="currentColor" strokeWidth="2" />
      <rect className="mark-bub" x="23" y="9" width="14" height="12" rx="6" fill="var(--vial)" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Mark size={size * 1.45} />
      <span className="display" style={{ fontSize: size, letterSpacing: "0.005em" }}>Steady</span>
    </span>
  );
}
