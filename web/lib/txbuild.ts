// Unsigned transactions built in the browser for /check. Nothing here signs or sends; the API simulates with a fresh blockhash.
import { Buffer } from "buffer";
import { Keypair, LAMPORTS_PER_SOL, MessageV0, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";

export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const TOKENS = {
  SOL: { mint: null, decimals: 9 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
} as const;
export type TokenName = keyof typeof TOKENS;

const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

function toB64(bytes: Uint8Array): string { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }
function u64(n: bigint): Uint8Array { const b = new Uint8Array(8); let x = n; for (let i = 0; i < 8; i++) { b[i] = Number(x & BigInt(255)); x >>= BigInt(8); } return b; }

export function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

function compile(payer: PublicKey, instructions: TransactionInstruction[]): string {
  return toB64(new VersionedTransaction(MessageV0.compile({ payerKey: payer, recentBlockhash: PLACEHOLDER_BLOCKHASH, instructions })).serialize());
}

/** Whole units to base units without floating point surprises. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const [i = "0", f = ""] = amount.trim().split(".");
  return BigInt(i || "0") * BigInt(10) ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** A plain send: SOL with the System program, or USDC/USDT with a token transfer (creating the recipient's account if needed). */
export function buildSend(from: string, to: string, token: TokenName, amount: string): { tx: string; touches: string[] } {
  const f = new PublicKey(from), t = new PublicKey(to);
  const spec = TOKENS[token];
  const base = toBaseUnits(amount, spec.decimals);
  if (!spec.mint) {
    return { tx: compile(f, [SystemProgram.transfer({ fromPubkey: f, toPubkey: t, lamports: base })]), touches: [to] };
  }
  const mint = new PublicKey(spec.mint);
  const src = ata(f, mint), dst = ata(t, mint);
  const createIdem = new TransactionInstruction({
    programId: ATA_PROGRAM, data: Buffer.from([1]),
    keys: [
      { pubkey: f, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: t, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
  const transferChecked = new TransactionInstruction({
    programId: TOKEN_PROGRAM, data: Buffer.from([12, ...u64(base), spec.decimals]),
    keys: [{ pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: f, isSigner: true, isWritable: false }],
  });
  return { tx: compile(f, [createIdem, transferChecked]), touches: [to, dst.toBase58()] };
}

/** The bad ones, built the way drainers build them, on any wallet. */
export function buildHiddenApproval(wallet: string): string {
  const w = new PublicKey(wallet);
  const usdc = ata(w, new PublicKey(TOKENS.USDC.mint));
  const approve = new TransactionInstruction({
    programId: TOKEN_PROGRAM, data: Buffer.from([4, ...u64(BigInt(10) ** BigInt(15))]),
    keys: [{ pubkey: usdc, isSigner: false, isWritable: true }, { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, { pubkey: w, isSigner: true, isWritable: false }],
  });
  // A small SOL "claim fee" transfer so it looks like an airdrop claim, with the approval tucked in.
  return compile(w, [SystemProgram.transfer({ fromPubkey: w, toPubkey: Keypair.generate().publicKey, lamports: 0.001 * LAMPORTS_PER_SOL }), approve]);
}

export function buildAccountHandover(wallet: string): string {
  const w = new PublicKey(wallet);
  const usdc = ata(w, new PublicKey(TOKENS.USDC.mint));
  const setAuthority = new TransactionInstruction({
    programId: TOKEN_PROGRAM, data: Buffer.from([6, 2, 1, ...Keypair.generate().publicKey.toBytes()]), // AccountOwner -> stranger
    keys: [{ pubkey: usdc, isSigner: false, isWritable: true }, { pubkey: w, isSigner: true, isWritable: false }],
  });
  return compile(w, [setAuthority]);
}

export function buildWalletTakeover(wallet: string): string {
  const w = new PublicKey(wallet);
  return compile(w, [SystemProgram.assign({ accountPubkey: w, programId: Keypair.generate().publicKey })]);
}

// An example "address you pay often", and a lookalike with the same first and last characters.
export const FRIEND = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
export const LOOKALIKE = "5Q544fGkpWDKQywMX2YTBdvf5T23KWFZHu5gpBpge4j1";
