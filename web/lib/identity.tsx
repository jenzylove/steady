"use client";
// One wallet for the whole visit: the connected Phantom wallet, or one pasted address remembered in this browser.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { isLikelyAddress } from "./api";

const KEY = "steady-wallet";

interface Identity {
  /** The wallet Steady uses: Phantom when connected, else the remembered address, else null. */
  wallet: string | null;
  source: "phantom" | "remembered" | null;
  remembered: string | null;
  remember: (w: string) => void;
  forget: () => void;
  ready: boolean;
}

const Ctx = createContext<Identity>({ wallet: null, source: null, remembered: null, remember: () => {}, forget: () => {}, ready: false });

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected } = useWallet();
  const [remembered, setRemembered] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v && isLikelyAddress(v)) setRemembered(v); } catch {}
    setReady(true);
  }, []);
  const remember = useCallback((w: string) => {
    const s = w.trim();
    if (!isLikelyAddress(s)) return;
    setRemembered(s);
    try { localStorage.setItem(KEY, s); } catch {}
  }, []);
  const forget = useCallback(() => { setRemembered(null); try { localStorage.removeItem(KEY); } catch {} }, []);
  const phantom = connected && publicKey ? publicKey.toBase58() : null;
  const wallet = phantom ?? remembered;
  return (
    <Ctx.Provider value={{ wallet, source: phantom ? "phantom" : remembered ? "remembered" : null, remembered, remember, forget, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export const useIdentity = () => useContext(Ctx);
