/**
 * Provider-agnostic text generation (always streamed).
 *
 * - anthropic: Claude through the official @anthropic-ai/sdk, with server-side
 *   refusal fallbacks enabled by default.
 * - openai:    any OpenAI-compatible /chat/completions endpoint.
 * - ollama:    Ollama's native /api/chat, so we can raise the context window
 *              (its OpenAI shim is stuck at the model default) and force JSON.
 */
import Anthropic from "@anthropic-ai/sdk";
import { llmConfig, type LlmConfig } from "./env";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface GenOptions {
  system: string;
  messages: ChatMsg[];
  maxTokens: number;
  /** Ask for a single JSON object (JSON mode where the provider supports it). */
  json?: boolean;
  signal?: AbortSignal;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = "llm_error",
  ) {
    super(message);
  }
}

/** Worth one more try: a flaky upstream (502), e.g. a small model stuck in a repetition loop. */
export function isRetriable(err: unknown): boolean {
  return err instanceof LlmError && err.status === 502;
}

export function requireLlm(): LlmConfig {
  const cfg = llmConfig();
  if (!cfg) {
    throw new LlmError(
      "No AI provider is configured. Add LLM_PROVIDER and LLM_API_KEY to .env.local (see .env.example).",
      503,
      "llm_not_configured",
    );
  }
  return cfg;
}

export async function* streamText(opts: GenOptions): AsyncGenerator<string> {
  const cfg = requireLlm();
  if (cfg.provider === "anthropic") yield* streamAnthropic(cfg, opts);
  else if (cfg.provider === "ollama") yield* streamOllama(cfg, opts);
  else yield* streamOpenAi(cfg, opts);
}

export async function completeText(opts: GenOptions): Promise<string> {
  let out = "";
  for await (const chunk of streamText(opts)) out += chunk;
  return out;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;
let anthropicKeyFor = "";

function anthropic(cfg: LlmConfig): Anthropic {
  const sig = `${cfg.apiKey ?? ""}|${cfg.baseUrl}`;
  if (!anthropicClient || anthropicKeyFor !== sig) {
    anthropicClient = new Anthropic({
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
      maxRetries: 2,
    });
    anthropicKeyFor = sig;
  }
  return anthropicClient;
}

async function* streamAnthropic(cfg: LlmConfig, opts: GenOptions): AsyncGenerator<string> {
  const client = anthropic(cfg);
  const isHaiku = cfg.model.includes("haiku");
  // Haiku has no server-side fallback; older Haiku also rejects `effort`.
  const useFallbacks = cfg.fallbacks && !isHaiku;
  const useEffort = !/haiku-4|claude-3/.test(cfg.model);
  try {
    const stream = client.beta.messages.stream(
      {
        model: cfg.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: opts.messages,
        ...(useEffort ? { output_config: { effort: cfg.effort } } : {}),
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: opts.signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      throw new LlmError("The model declined this request. Try rephrasing the topic.", 422, "refusal");
    }
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new LlmError("The Anthropic API key was rejected.", 401, "auth");
    if (err instanceof Anthropic.PermissionDeniedError) throw new LlmError("This API key can't use that model.", 403, "permission");
    if (err instanceof Anthropic.NotFoundError) throw new LlmError(`Model "${cfg.model}" was not found.`, 404, "model_not_found");
    if (err instanceof Anthropic.RateLimitError) throw new LlmError("Rate limited by Anthropic. Try again in a moment.", 429, "rate_limited");
    if (err instanceof Anthropic.APIUserAbortError) throw new LlmError("Request cancelled.", 499, "aborted");
    if (err instanceof Anthropic.APIConnectionError) throw new LlmError("Couldn't reach the Anthropic API.", 502, "network");
    if (err instanceof Anthropic.BadRequestError) throw new LlmError(`Anthropic rejected the request: ${err.message}`, 400, "bad_request");
    if (err instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error (${err.status ?? "unknown"}).`, 502, "upstream");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Server-sent events / NDJSON helpers
// ---------------------------------------------------------------------------

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) yield buf;
}

async function upstream(url: string, init: RequestInit, label: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new LlmError("Request cancelled.", 499, "aborted");
    throw new LlmError(`Couldn't reach ${label} at ${new URL(url).origin}.`, 502, "network");
  }
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const status = res.status === 401 || res.status === 403 ? 401 : res.status === 429 ? 429 : res.status === 404 ? 404 : 502;
    const msg =
      status === 401
        ? `${label} rejected the API key.`
        : status === 429
          ? `${label} rate limit reached. Try again shortly.`
          : status === 404
            ? `${label}: model or endpoint not found. ${detail}`
            : `${label} error ${res.status}. ${detail}`;
    throw new LlmError(msg.trim(), status, "upstream");
  }
  return res;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------

async function* streamOpenAi(cfg: LlmConfig, opts: GenOptions): AsyncGenerator<string> {
  const isOpenAi = cfg.baseUrl.includes("api.openai.com");
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    // Newer OpenAI models only accept max_completion_tokens; most other servers want max_tokens.
    [isOpenAi ? "max_completion_tokens" : "max_tokens"]: opts.maxTokens,
  };
  if (!isOpenAi) body.temperature = 0.5;
  if (opts.json && cfg.jsonMode) body.response_format = { type: "json_object" };
  const res = await upstream(
    `${cfg.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
    "The LLM API",
  );
  for await (const line of lines(res.body!)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const text = j.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text) yield text;
      if (j.error) throw new LlmError(String(j.error.message ?? "Upstream error"), 502, "upstream");
    } catch (e) {
      if (e instanceof LlmError) throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Ollama (native API)
// ---------------------------------------------------------------------------

/**
 * Ollama context sizing. A big fixed num_ctx bloats the KV cache and spills a
 * small model onto the CPU on 4-8 GB GPUs, which is several times slower. Use
 * the configured window (default 8192) and only grow it, in a few fixed steps
 * (each new size reloads the model), when a long upload doesn't fit.
 */
function ollamaWindow(opts: GenOptions): { numCtx: number; numPredict: number } {
  const base = Number(process.env.OLLAMA_NUM_CTX) || 8192;
  const chars = opts.system.length + opts.messages.reduce((n, m) => n + m.content.length, 0);
  const inputTokens = Math.ceil(chars / 3.2);
  const numCtx = inputTokens + 3072 <= base ? base : Math.min(32768, 2 ** Math.ceil(Math.log2(inputTokens + 6144)));
  return { numCtx, numPredict: Math.max(512, Math.min(opts.maxTokens, numCtx - inputTokens - 64)) };
}

async function* streamOllama(cfg: LlmConfig, opts: GenOptions): AsyncGenerator<string> {
  const { numCtx, numPredict } = ollamaWindow(opts);
  const res = await upstream(
    `${cfg.baseUrl}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
        ...(opts.json && cfg.jsonMode ? { format: "json" } : {}),
        options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0.5, repeat_penalty: 1.1 },
      }),
      signal: opts.signal,
    },
    "Ollama",
  );
  for await (const line of lines(res.body!)) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.error) throw new LlmError(`Ollama: ${j.error}`, 502, "upstream");
      const text = j.message?.content;
      if (typeof text === "string" && text) yield text;
      if (j.done) return;
    } catch (e) {
      if (e instanceof LlmError) throw e;
    }
  }
}
