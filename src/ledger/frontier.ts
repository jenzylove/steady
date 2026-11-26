// The blind control: a frontier model answers the same question with no tools, no web and none of Steady's data.
import "dotenv/config";
import type { Prediction } from "../engine/advice/types.js";

export const FRONTIER_MODEL = "claude-sonnet-5-5";

/** The plain question for a prediction: the question text and today's date, nothing else. */
export function frontierPrompt(question: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return [
    `Today's date is ${date}. You have no tools and no web access. Answer from your own knowledge and judgment.`,
    "",
    question,
    "",
    'Reply with only a JSON object: {"verdict": true or false, "value": a number in the unit the question names, "why": "one plain sentence"}.',
  ].join("\n");
}

export function parseFrontier(text: string): { verdict: boolean; value?: number; why: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("frontier answer had no JSON object");
  const j = JSON.parse(m[0]) as { verdict?: unknown; value?: unknown; why?: unknown };
  if (typeof j.verdict !== "boolean") throw new Error("frontier verdict is not a boolean");
  const value = typeof j.value === "number" && Number.isFinite(j.value) ? j.value : undefined;
  return { verdict: j.verdict, ...(value !== undefined ? { value } : {}), why: String(j.why ?? "").slice(0, 400) };
}

export type FrontierCall = (prompt: string) => Promise<string>;

export const callAnthropic: FrontierCall = async (prompt) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: FRONTIER_MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API http ${res.status}: ${(await res.text()).replace(key, "<key>").slice(0, 200)}`);
  const j: any = await res.json();
  return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
};

/** Ask the frontier model the question stored in params.question. */
export async function askFrontier(p: Prediction, now: Date = new Date(), call: FrontierCall = callAnthropic): Promise<NonNullable<Prediction["frontier"]>> {
  const question = p.params["question"];
  if (typeof question !== "string") throw new Error(`prediction ${p.id} has no params.question`);
  const out = parseFrontier(await call(frontierPrompt(question, now)));
  return { model: FRONTIER_MODEL, verdict: out.verdict, value: out.value, why: out.why };
}
