"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { PhantomWalletName } from "@solana/wallet-adapter-phantom";
import { Wordmark } from "./Logo";
import { short } from "@/lib/format";

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

export function ConnectButton() {
  const w = usePhantom();
  if (w.connected && w.publicKey) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => w.disconnect()} title="Disconnect">
        <span className="live-dot" /> <span className="mono">{short(w.publicKey.toBase58())}</span>
      </button>
    );
  }
  return (
    <button className="btn btn-sm" onClick={w.connectPhantom} disabled={w.connecting}>
      <span className="bub" /> {w.connecting ? "Connecting" : w.installed ? "Connect Phantom" : "Get Phantom"}
    </button>
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
          <ConnectButton />
          <button className="themebtn menubtn" aria-label="Menu" onClick={() => setOpen(!open)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
