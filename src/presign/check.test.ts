import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, StakeProgram, StakeAuthorizationLayout, type TransactionInstruction } from "@solana/web3.js";
import { controlChanges } from "./check.js";

const wallet = Keypair.generate().publicKey;
const tx = (ixs: TransactionInstruction[]) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message());

describe("control changes read from instruction bytes", () => {
  it("blocks a System assign of the wallet to another program (audit H2, live miss Nov 26)", () => {
    const t = tx([SystemProgram.assign({ accountPubkey: wallet, programId: Keypair.generate().publicKey })]);
    expect(controlChanges(t, wallet.toBase58()).join(" ")).toMatch(/reassigns your wallet/);
  });
  it("flags a stake authority move", () => {
    const stake = Keypair.generate().publicKey;
    const t = tx([...StakeProgram.authorize({ stakePubkey: stake, authorizedPubkey: wallet, newAuthorizedPubkey: Keypair.generate().publicKey, stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer }).instructions]);
    expect(controlChanges(t, wallet.toBase58()).join(" ")).toMatch(/stake account/);
  });
  it("flags a token SetAuthority", () => {
    const t = tx([{ programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), keys: [{ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, { pubkey: wallet, isSigner: true, isWritable: false }], data: Buffer.from([6, 2, 0]) }]);
    expect(controlChanges(t, wallet.toBase58()).join(" ")).toMatch(/SetAuthority/);
  });
  it("leaves a plain transfer alone", () => {
    const t = tx([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1000 })]);
    expect(controlChanges(t, wallet.toBase58())).toEqual([]);
  });
});
