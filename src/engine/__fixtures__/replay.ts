// Record and replay of network traffic for adapter tests. Keys never contain the RPC api key.
export type Recorded = RecordedCall;
export interface RecordedCall {
  key: string;
  status: number;
  body: string;
}

function normalizeBody(body: unknown): string {
  if (typeof body !== "string") return "";
  try {
    const j = JSON.parse(body);
    const strip = (x: any) => {
      if (x && typeof x === "object" && !Array.isArray(x) && "jsonrpc" in x) {
        const { id: _id, ...rest } = x;
        return rest;
      }
      return x;
    };
    return JSON.stringify(Array.isArray(j) ? j.map(strip) : strip(j));
  } catch {
    return body;
  }
}

export function callKey(input: RequestInfo | URL, init?: RequestInit): string {
  const url = String(typeof input === "object" && "url" in input ? (input as Request).url : input).replace(/([?&])api-key=[^&]*/g, "$1api-key=REDACTED");
  return `${(init?.method ?? "GET").toUpperCase()} ${url} ${normalizeBody(init?.body)}`;
}

export function recordingFetch(real: typeof fetch, calls: RecordedCall[]): typeof fetch {
  return (async (input: any, init?: any) => {
    const res = await real(input, init);
    const body = await res.clone().text();
    const key = callKey(input, init);
    if (!calls.some((c) => c.key === key)) calls.push({ key, status: res.status, body });
    return res;
  }) as typeof fetch;
}

function withIds(body: string, reqBody: unknown): string {
  if (typeof reqBody !== "string") return body;
  try {
    const rq = JSON.parse(reqBody);
    const rs = JSON.parse(body);
    if (Array.isArray(rq) && Array.isArray(rs)) {
      const byKey = rq.map((r: any) => r.id);
      return JSON.stringify(rs.map((r: any, i: number) => ({ ...r, id: byKey[i] ?? r.id })));
    }
    if (rq && !Array.isArray(rq) && "id" in rq && rs && typeof rs === "object") return JSON.stringify({ ...rs, id: rq.id });
  } catch { /* fall through */ }
  return body;
}

/** Older fixtures keyed requests as METHOD url(api-key=<redacted>) rawBody; accept those too. */
function legacyKey(input: RequestInfo | URL, init?: RequestInit): string {
  const url = String(typeof input === "object" && "url" in input ? (input as Request).url : input).replace(/([?&])api-key=[^&]*/g, "$1api-key=<redacted>");
  return `${(init?.method ?? "GET").toUpperCase()} ${url} ${typeof init?.body === "string" ? init.body : ""}`;
}

export function replayFetch(calls: RecordedCall[]): typeof fetch {
  const map = new Map(calls.map((c) => [c.key, c]));
  return (async (input: any, init?: any) => {
    const key = callKey(input, init);
    const hit = map.get(key) ?? map.get(legacyKey(input, init));
    if (!hit) throw new Error(`replay: no recorded response for ${key.slice(0, 300)}`);
    return new Response(withIds(hit.body, init?.body), { status: hit.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** Adapter context that replays recorded calls at a fixed time. */
export function replayContext(records: RecordedCall[], nowIso: string) {
  return { heliusRpcUrl: "https://mainnet.helius-rpc.com/?api-key=TESTKEY", fetch: replayFetch(records), now: () => new Date(nowIso) };
}
