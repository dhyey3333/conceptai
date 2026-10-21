import { z } from "zod";
import { LlmError } from "./llm";

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof LlmError) return jsonError(err.status === 499 ? 400 : err.status, err.code, err.message);
  if (err instanceof RequestError) return jsonError(err.status, "bad_request", err.message);
  console.error("[conceptai] unexpected error", err);
  return jsonError(500, "internal", "Something went wrong on the server.");
}

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Parse and validate a JSON body, rejecting oversized requests before parsing. */
export async function readJson<T extends z.ZodTypeAny>(req: Request, schema: T, maxBytes = 200_000): Promise<z.output<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new RequestError("Request too large.", 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new RequestError("Request too large.", 413);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RequestError("Body must be JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RequestError(`Invalid request: ${issue.path.join(".") || "body"} ${issue.message}`);
  }
  return parsed.data;
}

// --- Simple per-client rate limit (in memory; per server instance) ----------

const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(req: Request, name: string, perMinute: number): Response | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${name}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return jsonError(429, "rate_limited", "Too many requests. Please wait a few seconds.");
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  return null;
}

// --- NDJSON streaming --------------------------------------------------------

export type StreamEvent = Record<string, unknown> & { type: string };

/**
 * Stream events to the client as newline-delimited JSON. Errors thrown by the
 * generator become a final {"type":"error"} event (the HTTP status is already
 * sent by then). The client's abort cancels the upstream model call.
 */
export function ndjson(req: Request, run: (signal: AbortSignal) => AsyncGenerator<StreamEvent>): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (e: StreamEvent) => c.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const e of run(controller.signal)) send(e);
      } catch (err) {
        if (!controller.signal.aborted) {
          const message =
            err instanceof LlmError || err instanceof RequestError ? err.message : "Generation failed unexpectedly.";
          if (!(err instanceof LlmError)) console.error("[conceptai] stream error", err);
          send({ type: "error", message, code: err instanceof LlmError ? err.code : "internal" });
        }
      } finally {
        try {
          c.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// --- Shared request schemas --------------------------------------------------

export const LevelSchema = z.enum(["school", "senior", "college", "advanced"]).catch("college");
export const LanguageSchema = z.enum(["english", "hinglish", "hindi"]).catch("english");
export const DepthSchema = z.enum(["quick", "standard", "deep"]).catch("standard");
export const TopicSchema = z.string().trim().min(2, "is too short").max(300, "is too long");
export const SourceSchema = z.string().max(60_000).optional();

export const OutlineSchema = z.object({
  title: z.string().max(200),
  subject: z.string().max(80),
  summary: z.string().max(600),
  objectives: z.array(z.string().max(300)).max(8),
  sections: z.array(z.object({ id: z.string().max(20), title: z.string().max(200), goal: z.string().max(600) })).min(1).max(10),
});
