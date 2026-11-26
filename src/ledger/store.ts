// Append only JSON lines ledger. Every prediction is a signed memo; every settlement is a second signed memo that
// references the prediction memo by digest. Updates never rewrite a line: a new version is appended and supersedes the old.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Prediction } from "../engine/advice/types.js";
import { sign, type Signed } from "../memo/memo.js";
import type { Anchor } from "./anchor.js";

export const DEFAULT_LEDGER_PATH = resolve(process.cwd(), "data", "ledger.jsonl");

export interface Score {
  hit: boolean;
  /** Absolute error of the stated value against the settled value; undefined when no value was given. */
  absError?: number | undefined;
}
export type Outcome = NonNullable<Prediction["outcome"]>;

export interface SettlementBody {
  predictionId: string;
  predictionDigest: string; // digest of the signed prediction memo this settles
  settledAt: string;
  outcome: Outcome;
  score: { steady: Score; frontier?: Score | undefined; frontierInformed?: Score | undefined };
}

export type LedgerLine =
  | { type: "prediction"; memo: Signed<Prediction>; supersedes?: string }
  | { type: "settlement"; memo: Signed<SettlementBody> }
  | { type: "anchor"; anchor: Anchor };

export interface LedgerEntry {
  /** Latest version of the prediction, with the outcome merged in once settled. */
  prediction: Prediction;
  memo: Signed<Prediction>;
  /** The first signed version, made before any later update (for example adding the frontier answer). Its digest is what gets anchored. */
  firstMemo: Signed<Prediction>;
  settlement?: Signed<SettlementBody> | undefined;
}

export class Ledger {
  constructor(readonly path: string = process.env.LEDGER_PATH ?? DEFAULT_LEDGER_PATH) {}

  lines(): LedgerLine[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as LedgerLine);
  }

  load(): LedgerEntry[] {
    const byId = new Map<string, LedgerEntry>();
    const settlements: Signed<SettlementBody>[] = [];
    for (const line of this.lines()) {
      if (line.type === "prediction") {
        const prev = byId.get(line.memo.body.id);
        byId.set(line.memo.body.id, { prediction: line.memo.body, memo: line.memo, firstMemo: prev?.firstMemo ?? line.memo });
      } else if (line.type === "settlement") settlements.push(line.memo);
    }
    for (const s of settlements) {
      const e = byId.get(s.body.predictionId);
      if (!e) continue;
      e.settlement = s;
      e.prediction = { ...e.prediction, outcome: s.body.outcome };
    }
    return [...byId.values()];
  }

  get(id: string): LedgerEntry | undefined {
    return this.load().find((e) => e.prediction.id === id);
  }

  anchors(): Anchor[] {
    return this.lines().flatMap((l) => (l.type === "anchor" ? [l.anchor] : []));
  }

  writeAnchor(anchor: Anchor): void {
    this.write({ type: "anchor", anchor });
  }

  private write(line: LedgerLine): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(line) + "\n");
  }

  async append(p: Prediction): Promise<Signed<Prediction>> {
    if (this.get(p.id)) throw new Error(`prediction ${p.id} already exists; use update`);
    const { outcome: _o, ...body } = p;
    const memo = await sign<Prediction>(body);
    this.write({ type: "prediction", memo });
    return memo;
  }

  /** Append a new signed version of a prediction (for example once the frontier answer is in). Refused after settlement. */
  async update(id: string, patch: Partial<Omit<Prediction, "id" | "outcome">>): Promise<Signed<Prediction>> {
    const cur = this.get(id);
    if (!cur) throw new Error(`prediction ${id} not found`);
    if (cur.settlement) throw new Error(`prediction ${id} is already settled`);
    const memo = await sign<Prediction>({ ...cur.memo.body, ...patch });
    this.write({ type: "prediction", memo, supersedes: cur.memo.digest });
    return memo;
  }

  async settle(id: string, outcome: Outcome, score: SettlementBody["score"]): Promise<Signed<SettlementBody>> {
    const cur = this.get(id);
    if (!cur) throw new Error(`prediction ${id} not found`);
    if (cur.settlement) throw new Error(`prediction ${id} is already settled`);
    const memo = await sign<SettlementBody>({ predictionId: id, predictionDigest: cur.memo.digest, settledAt: outcome.settledAt, outcome, score });
    this.write({ type: "settlement", memo });
    return memo;
  }
}
