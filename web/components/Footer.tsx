import Link from "next/link";
import { Mark } from "./Logo";

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <p className="ink2" style={{ maxWidth: 360, fontSize: 15 }}>
              Steady reads your Solana wallet from mainnet, hands you the fix to sign, and keeps watching it. It never holds your keys or moves anything without you.
            </p>
          </div>
          <div className="foot-col">
            <span className="kicker">Use it</span>
            <Link href="/app">Check a wallet</Link>
            <Link href="/check">Check a transaction</Link>
            <Link href="/proof">Proof and ledger</Link>
            <Link href="/miner">The miner</Link>
          </div>
          <div className="foot-col">
            <span className="kicker">Elsewhere</span>
            <a href="https://github.com/jenzylove/steady" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://x.com/dollar782" target="_blank" rel="noreferrer">X @dollar782</a>
            <a href="https://t.me/steadysol_bot" target="_blank" rel="noreferrer">Telegram bot</a>
            <a href="https://telegraphprotocol.com" target="_blank" rel="noreferrer">Telegraph</a>
          </div>
        </div>
        <p className="mute" style={{ fontSize: 13, marginTop: 48 }}>
          Reads Solana mainnet. Pays Telegraph miners on testnet until Telegraph mainnet. Not investment advice.
        </p>
      </div>
      <div className="foot-word" aria-hidden="true">
        <span className="display">Steady</span>
        <span className="foot-mark"><Mark size={180} /></span>
      </div>
    </footer>
  );
}
