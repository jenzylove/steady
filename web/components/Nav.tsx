"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { PhantomWalletName } from "@solana/wallet-adapter-phantom";
import { Wordmark } from "./Logo";
import { short } from "@/lib/format";
import { isLikelyAddress } from "@/lib/api";
import { useIdentity } from "@/lib/identity";

/** One shared Phantom connection for the whole site. */
export function usePhantom() {
  const w = useWallet();
  const [want, setWant] = useState(false);
  useEffect(() => {
    if (want && w.wallet && !w.connected && !w.connecting) {
      w.connect().catch(() => {}).finally(() => setWant(false));
    }
  }, [want, w]);
  const installed = w.wallets.some((x) => x.adapter.name === PhantomWalletName && (x.readyState === WalletReadyState.Installed || x.readyState === WalletReadyState.Loadable));
  const connect = () => {
    if (!installed) { window.open("https://phantom.app/download", "_blank", "noopener"); return; }
    w.select(PhantomWalletName as WalletName);
    setWant(true);
  };
  return { ...w, installed, connectPhantom: connect };
}

/** The one wallet for the visit, shown and changed from the nav. */
export function WalletChip() {
  const w = usePhantom();
  const id = useIdentity();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const save = () => {
    if (!isLikelyAddress(v)) { setErr("That does not look like a Solana wallet address."); return; }
    id.remember(v.trim()); setV(""); setErr(""); setOpen(false);
  };
  const label = w.connecting ? "Connecting" : id.wallet ? short(id.wallet) : "Your wallet";
  return (
    <div className="wchip" ref={box}>
      <button className={`btn btn-sm ${id.wallet ? "btn-ghost" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={id.wallet ? `Your wallet ${id.wallet}. Change it` : "Choose your wallet"}>
        {id.wallet ? <span className="live-dot" /> : <span className="bub" />} <span className={id.wallet ? "mono" : ""}>{label}</span>
      </button>
      {open && (
        <div className="wmenu" role="dialog" aria-label="Your wallet">
          {id.wallet ? (
            <>
              <span className="kicker">{id.source === "phantom" ? "Connected with Phantom" : "Remembered in this browser"}</span>
              <p className="mono" style={{ fontSize: 13, wordBreak: "break-all", margin: "8px 0 14px" }}>{id.wallet}</p>
              <div className="wmenu-acts">
                <button className="btn btn-sm" onClick={() => { setOpen(false); router.push(`/app?wallet=${id.wallet}`); }}><span className="bub" /> Read it now</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); router.push("/check"); }}>Check a transaction</button>
              </div>
            </>
          ) : (
            <p className="ink2" style={{ fontSize: 14, marginBottom: 12 }}>Pick one wallet and every page uses it. Looking needs no signature.</p>
          )}
          <span className="kicker" style={{ display: "block", marginTop: id.wallet ? 18 : 0 }}>{id.wallet ? "Use another wallet" : "Paste an address"}</span>
          <form className="wmenu-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input className="field" value={v} onChange={(e) => { setV(e.target.value); setErr(""); }} placeholder="Solana wallet address" aria-label="Solana wallet address" spellCheck={false} autoComplete="off" />
            <button className="btn btn-sm" type="submit">Use it</button>
          </form>
          {err && <p style={{ color: "var(--risk)", fontSize: 13, marginTop: 6 }}>{err}</p>}
          <div className="wmenu-foot">
            {w.connected ? (
              <button className="linkbtn" onClick={() => { w.disconnect(); setOpen(false); }}>Disconnect Phantom</button>
            ) : (
              <button className="linkbtn" onClick={() => { w.connectPhantom(); setOpen(false); }}>{w.installed ? "Connect Phantom instead" : "Get Phantom"}</button>
            )}
            {id.remembered && id.source !== "phantom" && <button className="linkbtn" onClick={() => { id.forget(); setOpen(false); }}>Forget this wallet</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => { setTheme(document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")); }, []);
  const flip = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("steady-theme", next); } catch {}
    setTheme(next);
  };
  return (
    <button onClick={flip} aria-label="Switch light and dark" className="themebtn" title="Light or dark">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg>
    </button>
  );
}

const LINKS = [
  { href: "/app", label: "App" },
  { href: "/check", label: "Check a transaction" },
  { href: "/proof", label: "Proof" },
  { href: "/miner", label: "Miner" },
];

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="nav">
      <div className="nav-in">
        <Link href="/" style={{ textDecoration: "none" }} aria-label="Steady home"><Wordmark size={21} /></Link>
        <nav className={`nav-links ${open ? "open" : ""}`}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "on" : ""}>{l.label}</Link>
          ))}
        </nav>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <WalletChip />
          <button className="themebtn menubtn" aria-label="Menu" onClick={() => setOpen(!open)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
