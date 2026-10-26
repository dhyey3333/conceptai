/** Browser-side helpers for calling our API routes. */

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "error",
    public status = 0,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<ApiError> {
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    return new ApiError(j.message ?? `Request failed (${res.status})`, j.error ?? "error", res.status);
  } catch {
    return new ApiError(`Request failed (${res.status})`, "error", res.status);
  }
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Couldn't reach the ConceptAI server.", "network");
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export type StreamEvent = { type: string; [k: string]: unknown };

/** POST and consume a newline-delimited JSON stream, calling onEvent for each event. */
export async function streamNdjson(url: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Couldn't reach the ConceptAI server.", "network");
  }
  if (!res.ok || !res.body) throw await failure(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: StreamEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "error") throw new ApiError(String(ev.message ?? "Generation failed."), String(ev.code ?? "error"));
      onEvent(ev);
    }
  }
}

export interface ServerStatus {
  llm: {
    configured: boolean;
    provider?: string;
    model?: string;
    /** cheaper model for easy topics, when different from the main one */
    fast?: { provider: string; model: string };
    research?: "web" | "wikipedia" | "off";
    /** generate one request at a time (local model or rate-limited plan) */
    sequential?: boolean;
    /** model that takes over when the main one can't answer (e.g. a local one) */
    fallback?: string;
    /** a setup mistake seen recently (rejected key, unknown model) */
    problem?: string;
  };
  tts: { configured: boolean; provider?: string };
  stt: { configured: boolean };
  supabase: { configured: boolean };
  /** The Python helper: running, or still starting (it takes a few seconds after the app starts). */
  python?: { up: boolean; starting?: boolean };
}

let statusPromise: Promise<ServerStatus> | null = null;
export function fetchStatus(): Promise<ServerStatus> {
  statusPromise ??= fetch("/api/status")
    .then((r) => r.json() as Promise<ServerStatus>)
    .catch(() => ({ llm: { configured: false }, tts: { configured: false }, stt: { configured: false }, supabase: { configured: false } }));
  return statusPromise;
}

/** Ask the server again (the cached status can be out of date, e.g. while the Python helper starts). */
export function refreshStatus(): Promise<ServerStatus> {
  statusPromise = null;
  return fetchStatus();
}
