import { describe, expect, it } from "vitest";
import type { Advice, Finding, Severity } from "../engine/advice/types.js";
import { formatReport, fixLink } from "./report.js";
import { diffFindings } from "./watch.js";
import { looksLikeSecret, isSolanaAddress } from "./bot.js";

const W = "44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS";
const f = (id: string, severity: Severity, extra: Partial<Finding> = {}): Finding => ({ id, kind: "risk", code: "x", severity, title: `t <${id}>`, numbers: { health: 1.02 }, sources: [], evidence: [], ...extra });
const advice = (findings: Finding[]): Advice => ({ wallet: W, at: "2026-11-26T00:00:00Z", totalUsd: 1234.5, findings, gaps: [], costUsd: 0, checks: [{ intent: "i", used: true, summary: "s" }, { intent: "i", used: false, summary: "s", rejectReason: "r" }] });

describe("report", () => {
  it("sorts by severity, caps at 5, escapes, links fixes", () => {
    const fx = f("risk:liq:a", "critical", { fix: { action: "repay", protocol: "kamino", amount: 1, reason: "Repay 50 USDC" } });
    const m = formatReport(advice([f("a1", "low"), f("a2", "info"), f("a3", "medium"), f("a4", "high"), fx, f("a6", "info")]));
    expect(m.indexOf("CRITICAL")).toBeLessThan(m.indexOf("HIGH"));
    expect(m).toContain("Fix ready: Repay 50 USDC");
    expect(m).toContain(fixLink(W, "risk:liq:a"));
    expect(m).toContain("&lt;a4&gt;");
    expect(m).toContain("+1 more");
    expect(m).toContain("1 Telegraph answer used, 1 rejected");
    expect(m.length).toBeLessThan(3500);
  });
  it("stays under the limit with long titles", () => {
    const fs = Array.from({ length: 8 }, (_, i) => f(`id${i}`, "high", { title: "x".repeat(900) }));
    expect(formatReport(advice(fs)).length).toBeLessThanOrEqual(3500);
  });
  it("handles an empty wallet", () => expect(formatReport(advice([]))).toContain("Nothing needs attention"));
});

describe("watch diff", () => {
  it("alerts on new high, worsened, ignores unchanged and low", () => {
    const prev = { a: "high", b: "medium", c: "high", d: "info" } as Record<string, Severity>;
    const d = diffFindings(prev, [f("a", "high"), f("b", "critical"), f("c", "critical"), f("e", "high"), f("g", "medium"), f("d", "info")]);
    expect(d.alerts.map((x) => x.id).sort()).toEqual(["b", "c", "e"]);
    expect(d.added).toEqual(["e"]);
    expect(d.worsened.sort()).toEqual(["b", "c"]);
    expect(d.seen.g).toBe("medium");
  });
  it("is quiet when nothing changed or improved", () => {
    expect(diffFindings({ a: "critical" }, [f("a", "high")]).alerts).toHaveLength(0);
    expect(diffFindings({ a: "high" }, [f("a", "high")]).alerts).toHaveLength(0);
  });
});

describe("input guards", () => {
  it("catches seed phrases and keys, not addresses", () => {
    expect(looksLikeSecret("abandon ability able about above absent absorb abstract absurd abuse access accident")).toBe(true);
    expect(looksLikeSecret("5".repeat(88))).toBe(true);
    expect(looksLikeSecret(W)).toBe(false);
    expect(isSolanaAddress(W)).toBe(true);
    expect(isSolanaAddress("hello")).toBe(false);
  });
});

describe("start payload", () => {
  it("t.me/steadysol_bot?start=<wallet> watches that wallet; bare /start welcomes; stats hold counts only", async () => {
    const { handleText, WELCOME } = await import("./bot.js");
    const { botStats } = await import("./stats.js");
    const sent: string[] = [];
    const state = {} as Record<string, { address: string; seen: Record<string, Severity> }[]>;
    const d: any = { tg: { send: async (_c: string, t: string) => { sent.push(t); } }, ctx: {}, state, save: () => {}, run: async () => advice([]) };
    await handleText(d, "42", "/start");
    expect(sent.at(-1)).toBe(WELCOME);
    await handleText(d, "42", `/start ${W}`);
    expect(state["42"]?.map((w) => w.address)).toEqual([W]);
    expect(sent.some((t) => t.startsWith("Watching."))).toBe(true);
    const s = botStats(state as any);
    expect(s).toMatchObject({ chats: 1, walletsWatched: 1 });
    expect(JSON.stringify(s)).not.toContain(W);
    expect(JSON.stringify(s)).not.toContain("42\"");
  });
});

describe("limits", () => {
  it("caps watched wallets per chat, including start links, and one off checks per day", async () => {
    const { handleText, MAX_WATCH, allowCheck, CHECKS_PER_DAY } = await import("./bot.js");
    const sent: string[] = [];
    const state: Record<string, { address: string; seen: Record<string, Severity> }[]> = { c: Array.from({ length: MAX_WATCH }, (_, i) => ({ address: `${i}`.padEnd(32, "1"), seen: {} })) };
    const d: any = { tg: { send: async (_c: string, t: string) => { sent.push(t); } }, ctx: {}, state, save: () => {}, run: async () => advice([]) };
    await handleText(d, "c", `/start ${W}`);
    expect(state.c).toHaveLength(MAX_WATCH);
    expect(sent.at(-1)).toContain("the most one chat can");
    const day = new Date("2026-11-26T10:00:00Z");
    for (let i = 0; i < CHECKS_PER_DAY; i++) expect(allowCheck("x", day)).toBe(true);
    expect(allowCheck("x", day)).toBe(false);
    expect(allowCheck("x", new Date("2026-11-27T00:00:01Z"))).toBe(true);
  });
});
