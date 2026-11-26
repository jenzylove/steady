import Link from "next/link";
import HeroDemo from "@/components/HeroDemo";
import Flow from "@/components/Flow";
import Door from "@/components/Door";
import LedgerPreview from "@/components/LedgerPreview";
import MinerLive from "@/components/MinerLive";
import Reveal from "@/components/Reveal";
import RunningNow from "@/components/RunningNow";

function Tilted({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      {text.split(" ").map((w, k) => (
        <span key={k} className="tilt-word" style={{ animationDelay: `${start + k * 90}ms` }}>{w}&nbsp;</span>
      ))}
    </>
  );
}

const FAQ = [
  { q: "Does Steady hold my keys or my money?", a: "No. Steady only reads public chain data. When it prepares a fix, the transaction goes to Phantom and nothing happens unless you approve it there." },
  { q: "Do I need to connect a wallet to look?", a: "No. Paste any address and Steady reads it. You connect Phantom only when you want to sign a fix for your own wallet." },
  { q: "What is Telegraph, and why ask miners at all?", a: "Telegraph is a network where independent miners sell answers to questions, each with a receipt. Steady reads balances, loans and pools from the chain itself. It pays miners for what the chain cannot know, like protocol news and sanctions lists. For a lending rate it asks several miners and drops any answer far from the public rate, so a single wrong answer cannot steer you." },
  { q: "What happens when a miner is wrong?", a: "The answer is struck out and kept as evidence with the reason. In our own paid tests one miner said marginfi pays 330% on USDC, and one said $3.5M for an Orca pool holding about $17.9M. Neither would have moved a cent." },
  { q: "How do I know the numbers are right?", a: "Steady's health number matched Kamino's own within 0.5% on 14 real loans, and marginfi's within 0.41% on 12. Every recommendation also comes as a signed memo listing each read and each miner answer, so you can check it yourself." },
  { q: "Does Steady keep working after I close the tab?", a: "Yes, if you want it to. Tap Watch this wallet after a read and the Steady Telegram bot rereads it every 15 minutes. It messages you only when a risk is new or gets worse, with the fix ready to sign. The numbers at the top of this page are live counts of that work." },
  { q: "What does it cost?", a: "Checking a wallet is free, up to 20 checks a day. Steady pays the miners. Payments to Telegraph run on its testnet until Telegraph mainnet; every read of your wallet is real Solana mainnet." },
  { q: "Is this investment advice?", a: "No. Steady shows you facts about your own positions and a fix you can choose to sign. Code decides every finding and every fix, and the words come from those same rules. No language model writes your advice." },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="kicker hero-kicker">For anyone with real money on Solana</p>
          <h1 className="display hero-h1">
            <Tilted text="Know what could hurt your" /><br className="br-wide" />
            <Tilted text="Solana wallet." start={450} />{" "}
            <span className="hero-steady"><Tilted text="Then fix it." start={700} /></span>
          </h1>
          <p className="hero-sub ink2">
            Paste any wallet. Steady reads everything it holds from Solana mainnet, buys what the chain cannot know from Telegraph miners, and hands you the exact transaction to sign in Phantom. Then it keeps watching.
          </p>
          <HeroDemo />
          <div className="hero-door">
            <Door autoFocus={false} />
          </div>
          <RunningNow />
        </div>
      </section>

      <section className="sec" id="how">
        <div className="wrap">
          <Reveal className="sec-head">
            <span className="sec-num">01</span>
            <h2 className="display sec-title">How it works</h2>
          </Reveal>
          <Reveal><Flow /></Reveal>
        </div>
      </section>

      <section className="sec" id="proof">
        <div className="wrap">
          <Reveal className="sec-head">
            <span className="sec-num">02</span>
            <h2 className="display sec-title">Proof, not promises</h2>
          </Reveal>
          <div className="trio">
            <Reveal className="trio-i">
              <span className="num-xl">0.5%</span>
              <p className="ink2">Steady&apos;s loan health matched Kamino&apos;s own number within half a percent on 14 real loans.</p>
            </Reveal>
            <Reveal className="trio-i" delay={120}>
              <span className="num-xl"><span className="strike">330%</span></span>
              <p className="ink2">What one paid miner said marginfi pays on USDC. A single source would have acted on it. Steady rejected it.</p>
            </Reveal>
            <Reveal className="trio-i" delay={240}>
              <span className="num-xl"><span className="strike">$3.5M</span></span>
              <p className="ink2">What one miner said an Orca SOL/USDC pool holds. The chain says about $17.9M.</p>
            </Reveal>
          </div>
          <Reveal className="ledger-wrap">
            <div>
              <span className="kicker">The forward ledger</span>
              <h3 className="display" style={{ fontSize: "clamp(28px, 3.4vw, 44px)", margin: "12px 0 14px" }}>Calls signed before the outcome. Misses published.</h3>
              <p className="ink2" style={{ maxWidth: 420 }}>Will this loan still be safe tomorrow? Will this rate hold for three days? Steady signs its answer first, then settles it from mainnet. A frontier model answers the same questions blind.</p>
            </div>
            <LedgerPreview />
          </Reveal>
        </div>
      </section>

      <section className="sec" id="sign">
        <div className="wrap">
          <Reveal className="sec-head">
            <span className="sec-num">03</span>
            <h2 className="display sec-title">Before you sign anything</h2>
          </Reveal>
          <Reveal className="split">
            <p className="ink2 big">
              Check a send before you make it, or a transaction a site wants you to sign. Steady runs it on mainnet first and tells you what leaves your wallet, who gains control of your tokens or the wallet itself, and whether the recipient imitates an address you have paid before.
            </p>
            <div className="verdicts">
              <div><span className="display v ok">OK</span><span className="mute">No takeover, drain or hidden approval found</span></div>
              <div><span className="display v warn">Caution</span><span className="mute">Read the reasons first</span></div>
              <div><span className="display v risk">Block</span><span className="mute">Do not sign this</span></div>
              <Link href="/check" className="btn" style={{ textDecoration: "none", marginTop: 18, width: "fit-content" }}><span className="bub" /> Check a transaction</Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="sec" id="miner">
        <div className="wrap">
          <Reveal className="sec-head">
            <span className="sec-num">04</span>
            <h2 className="display sec-title">The miner</h2>
          </Reveal>
          <Reveal className="split">
            <div>
              <p className="ink2 big">Steady also sells one answer to every app on Telegraph: how much money sits in a Solana pool right now, read from the pool&apos;s own vaults on Orca, Raydium and Meteora. No third party index in between.</p>
              <p className="mute" style={{ marginTop: 18, fontSize: 15 }}>Registration 6203, Telegraph miner id 7420317, serving pool liquidity checks.</p>
              <Link href="/miner" className="btn btn-ghost" style={{ textDecoration: "none", marginTop: 26 }}><span className="bub" /> See the live board</Link>
            </div>
            <MinerLive />
          </Reveal>
        </div>
      </section>

      <section className="sec" id="faq">
        <div className="wrap">
          <Reveal className="sec-head">
            <span className="sec-num">05</span>
            <h2 className="display sec-title">Questions</h2>
          </Reveal>
          <Reveal>
            {FAQ.map((f, k) => (
              <details key={f.q} className="row" open={k === 0}>
                <summary><span style={{ fontSize: 20, fontWeight: 500 }}>{f.q}</span><span className="chev" /></summary>
                <div className="body">{f.a}</div>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="sec closing">
        <div className="wrap">
          <Reveal>
            <h2 className="display" style={{ fontSize: "clamp(44px, 8vw, 120px)", marginBottom: 40 }}>Check a wallet now.</h2>
            <Door cta="Check it" />
          </Reveal>
        </div>
      </section>
    </>
  );
}
