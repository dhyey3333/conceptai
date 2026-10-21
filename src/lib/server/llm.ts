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
import { budgetFor, isLocal, llmConfig, providerChain, type LlmConfig, type Tier } from "./env";
import { startOllama } from "./ollama";

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
  /** Which model tier answers: "fast" for easy material, "best" (default) for hard. */
  tier?: Tier;
  /** Told why generation ended; "length" means the output hit its token limit. */
  onStop?: (reason: "length" | "end") => void;
  /** Minimum reasoning effort for this call (raises, never lowers, the configured effort). */
  minEffort?: "low" | "medium" | "high";
  /**
   * A fact-check: each provider's VERIFY_MODEL goes first, and local models
   * are never used (a small model "correcting" a big one does harm).
   */
  check?: boolean;
  /** Told when another model takes over because the main one can't answer. */
  onFallback?: (notice: FallbackNotice) => void;
}

const EFFORT_ORDER = ["low", "medium", "high"];

/** The higher of two effort levels; unknown values count as the configured one. */
export function atLeast(configured: string | undefined, minimum: string | undefined): string | undefined {
  if (!minimum) return configured;
  if (!configured) return minimum;
  return EFFORT_ORDER.indexOf(minimum) > EFFORT_ORDER.indexOf(configured) ? minimum : configured;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = "llm_error",
    /** For code "quota": roughly when this model can be used again. */
    public retryInMs?: number,
  ) {
    super(message);
  }
}

/** Worth one more try: a flaky upstream (502), e.g. a small model stuck in a repetition loop. */
export function isRetriable(err: unknown): boolean {
  return err instanceof LlmError && err.status === 502;
}

export function requireLlm(tier: Tier = "best"): LlmConfig {
  const cfg = llmConfig(tier);
  if (!cfg) {
    throw new LlmError(
      "No AI provider is configured. Add LLM_PROVIDER and LLM_API_KEY to .env.local (see .env.example).",
      503,
      "llm_not_configured",
    );
  }
  return cfg;
}

/** Models that ran out of quota, and when to try them again (per server process). */
const outOfQuota = new Map<string, number>();
const keyOf = (cfg: LlmConfig) => `${cfg.provider}:${cfg.baseUrl}:${cfg.model}`;

/** Why the main model couldn't answer, and what is answering instead. */
export interface FallbackNotice {
  from: string;
  to: string;
  /** "config": a setup mistake (rejected key, unknown model) that the owner must fix. */
  reason: "quota" | "busy" | "offline" | "config" | "error";
  /** Whether the stand-in runs on this computer (slower, smaller). */
  local: boolean;
  /** Roughly when the main model's allowance frees up. */
  minutes?: number;
  /** For "config": what is wrong, in words. */
  detail?: string;
}

export function fallbackMessage(n: FallbackNotice): string {
  const why =
    n.reason === "quota"
      ? `${n.from} has used up its free allowance for now${n.minutes ? ` (it frees up in about ${n.minutes} min)` : ""}`
      : n.reason === "busy"
        ? `${n.from} is rate-limited right now`
        : n.reason === "offline"
          ? `${n.from} can't be reached (are you offline?)`
          : n.reason === "config"
            ? `${n.from} can't be used: ${n.detail ?? "check its settings"}. Fix it in .env.local and restart`
            : `${n.from} isn't responding`;
  return `${why}. Meanwhile ${n.to} is teaching${n.local ? " on this computer: slower, and less precise" : ""}.`;
}

/** The last setup mistake seen (shown in the sidebar), so a fallback never hides it. */
let configProblem: { message: string; at: number } | null = null;

export function currentConfigProblem(): string | undefined {
  return configProblem && Date.now() - configProblem.at < 60 * 60_000 ? configProblem.message : undefined;
}

function reasonOf(err: LlmError): FallbackNotice["reason"] {
  if (err.code === "quota") return "quota";
  if (err.code === "rate_limited") return "busy";
  if (err.code === "network") return "offline";
  if (err.status === 401 || err.status === 403 || err.status === 404) return "config";
  return "error";
}

function configDetail(err: LlmError): string {
  if (err.status === 401) return "its API key was rejected";
  if (err.status === 403) return "this API key isn't allowed to use it";
  return "the model name wasn't found";
}

/**
 * Anything another model might get around: limits, outages, no connection,
 * and setup mistakes too (a rejected key, an unknown model), which are then
 * reported loudly instead of stopping the lesson. Only a cancelled request
 * ends the chain.
 */
function canFallBack(err: unknown): err is LlmError {
  return err instanceof LlmError && err.code !== "aborted";
}

/** The models to try for one call, in order, across every provider in the chain. */
function callChain(opts: Pick<GenOptions, "tier" | "check">): LlmConfig[] {
  const head = requireLlm(opts.tier);
  const out: LlmConfig[] = [];
  for (const link of providerChain()) {
    if (opts.check && isLocal(link.configs[0])) continue;
    let configs = link.configs;
    if (opts.check && link.verifyModel) {
      const checker = configs.find((c) => c.model === link.verifyModel) ?? { ...configs[0], model: link.verifyModel };
      configs = [checker, ...configs.filter((c) => c !== checker)];
    }
    out.push(...configs);
  }
  // The tier's model (e.g. a cheaper one for easy topics) teaches first when it isn't already.
  if (!opts.check && keyOf(head) !== keyOf(out[0] ?? head)) out.unshift(head);
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(keyOf(c)) && seen.add(keyOf(c)));
}

/** The model that would answer right now: the first one in the chain that isn't out of quota. */
export function activeConfig(tier?: Tier): LlmConfig | null {
  const chain = callChain({ tier });
  return chain.find((c) => (outOfQuota.get(keyOf(c)) ?? 0) <= Date.now()) ?? chain[0] ?? null;
}

/**
 * Characters of uploaded material that fit in one request, sized for the
 * model that will actually answer (if Gemini is used up and Groq's small
 * per-minute budget takes over, the material is trimmed to fit it).
 */
export function sourceBudget(tier: Tier | undefined, use: "plan" | "part" | "notes"): number {
  return budgetFor(activeConfig(tier), use);
}

/**
 * Stream from the first model of the provider chain, falling back down the
 * chain when it can't answer (out of quota, rate-limited, offline, failing or
 * set up wrong): other models of the same provider, then the next providers,
 * ending with a local model, so a used-up free plan or a lost connection slows
 * lessons down instead of stopping them. A model that is out of quota is
 * skipped until it frees up.
 */
export async function* streamText(opts: GenOptions): AsyncGenerator<string> {
  const chain = callChain(opts);
  const usable = chain.filter((c) => (outOfQuota.get(keyOf(c)) ?? 0) <= Date.now());
  const order = usable.length ? usable : chain;
  // Starting on a stand-in because the main model is known to be out of quota.
  if (order[0] !== chain[0]) {
    const until = outOfQuota.get(keyOf(chain[0])) ?? 0;
    opts.onFallback?.({ from: chain[0].model, to: order[0].model, reason: "quota", local: isLocal(order[0]), minutes: Math.max(1, Math.ceil((until - Date.now()) / 60_000)) });
  }
  for (let i = 0; i < order.length; i++) {
    const cfg = order[i];
    let started = false;
    try {
      const stream = cfg.provider === "anthropic" ? streamAnthropic(cfg, opts) : cfg.provider === "ollama" ? streamOllama(cfg, opts) : streamOpenAi(cfg, opts);
      for await (const chunk of stream) {
        started = true;
        yield chunk;
      }
      return;
    } catch (err) {
      const next = order[i + 1];
      if (started || !next || !canFallBack(err)) throw err;
      if (err.code === "quota") outOfQuota.set(keyOf(cfg), Date.now() + (err.retryInMs ?? 15 * 60_000));
      const reason = reasonOf(err);
      const detail = reason === "config" ? configDetail(err) : undefined;
      if (detail) configProblem = { message: `${cfg.model}: ${detail}. Fix it in .env.local and restart.`, at: Date.now() };
      console.warn(`[conceptai] ${cfg.model}: ${err.message} Using ${next.model} instead.`);
      opts.onFallback?.({ from: cfg.model, to: next.model, reason, local: isLocal(next), detail, minutes: err.retryInMs ? Math.ceil(err.retryInMs / 60_000) : undefined });
    }
  }
}

export async function completeText(opts: GenOptions): Promise<string> {
  let out = "";
  for await (const chunk of streamText(opts)) out += chunk;
  return out;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const anthropicClients = new Map<string, Anthropic>();

export function anthropic(cfg: LlmConfig): Anthropic {
  const sig = `${cfg.apiKey ?? ""}|${cfg.baseUrl}`;
  let client = anthropicClients.get(sig);
  if (!client) {
    client = new Anthropic({
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
      maxRetries: 2,
    });
    anthropicClients.set(sig, client);
  }
  return client;
}

/** Request fields every Claude call shares: effort, and server-side refusal fallbacks. */
export function claudeExtras(cfg: LlmConfig, minEffort?: GenOptions["minEffort"]) {
  // Haiku has no server-side fallback; older Haiku also rejects `effort`.
  const useFallbacks = cfg.fallbacks && !cfg.model.includes("haiku");
  const useEffort = !/haiku-4|claude-3/.test(cfg.model);
  return {
    ...(useEffort ? { output_config: { effort: atLeast(cfg.effort, minEffort) as LlmConfig["effort"] } } : {}),
    ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

/** Map SDK errors (most specific first) to messages the UI can show. */
export function claudeError(err: unknown, cfg: LlmConfig): unknown {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("The Anthropic API key was rejected.", 401, "auth");
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError("This API key can't use that model.", 403, "permission");
  if (err instanceof Anthropic.NotFoundError) return new LlmError(`Model "${cfg.model}" was not found.`, 404, "model_not_found");
  if (err instanceof Anthropic.RateLimitError) return new LlmError("Rate limited by Anthropic. Try again in a moment.", 429, "rate_limited");
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError("Request cancelled.", 499, "aborted");
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("Couldn't reach the Anthropic API.", 502, "network");
  if (err instanceof Anthropic.BadRequestError) return new LlmError(`Anthropic rejected the request: ${err.message}`, 400, "bad_request");
  if (err instanceof Anthropic.APIError) return new LlmError(`Anthropic API error (${err.status ?? "unknown"}).`, 502, "upstream");
  return err;
}

async function* streamAnthropic(cfg: LlmConfig, opts: GenOptions): AsyncGenerator<string> {
  const client = anthropic(cfg);
  try {
    const stream = client.beta.messages.stream(
      {
        model: cfg.model,
        max_tokens: opts.maxTokens,
        // The system prompt (persona + board language) is identical for every
        // part of a lesson, so cache it; repeat calls read it at the cache rate.
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: opts.messages,
        ...claudeExtras(cfg, opts.minEffort),
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
    opts.onStop?.(final.stop_reason === "max_tokens" ? "length" : "end");
  } catch (err) {
    throw claudeError(err, cfg);
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

/** Retry-After as milliseconds (seconds or an HTTP date); null when absent or unreadable. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new LlmError("Request cancelled.", 499, "aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Keep prompt + requested output inside a per-minute token budget. Free
 * tiers such as Groq's (8K tokens/minute) reject or throttle requests that
 * can't fit, so long outputs (notes) are capped rather than failing.
 */
export function fitToBudget(opts: Pick<GenOptions, "system" | "messages" | "maxTokens">, tpmLimit?: number): number {
  if (!tpmLimit) return opts.maxTokens;
  const chars = opts.system.length + opts.messages.reduce((n, m) => n + m.content.length, 0);
  const inputTokens = Math.ceil(chars / 3.5);
  return Math.max(512, Math.min(opts.maxTokens, tpmLimit - inputTokens - 256));
}

/** "7.66s", "1m2.5s", "450ms" (Groq's reset headers and error messages) in milliseconds. */
export function durationMs(text: string | null | undefined): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/.exec(text?.trim() ?? "");
  if (!m || !m.slice(1).some(Boolean)) return null;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0);
}

/**
 * How long a 429 asks us to wait: Retry-After, else "try again in 7.6s" from the
 * message (which names the limit actually hit, e.g. the daily one), else the
 * per-minute token reset header.
 */
export function rateLimitWaitMs(headers: Headers, body: string): number | null {
  return (
    retryAfterMs(headers.get("retry-after")) ??
    durationMs(/try again in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?(?:[\d.]+ms)?)/i.exec(body)?.[1]) ??
    durationMs(headers.get("x-ratelimit-reset-tokens"))
  );
}

/** How long one request may keep waiting out per-minute rate limits before giving up. */
const RATE_LIMIT_PATIENCE_MS = 120_000;

async function upstream(url: string, init: RequestInit, label: string): Promise<Response> {
  let res: Response;
  let errorText: string | undefined;
  const giveUpAt = Date.now() + RATE_LIMIT_PATIENCE_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, init);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new LlmError("Request cancelled.", 499, "aborted");
      throw new LlmError(`Couldn't reach ${label} at ${new URL(url).origin}.`, 502, "network");
    }
    errorText = undefined;
    if (res.status !== 429) break;
    // Rate limited: wait as long as the server asks, and keep trying while the
    // window is shared with other requests (writing and checking at once), up
    // to a time budget. A wait longer than a minute means the quota is used up.
    errorText = await res.text().catch(() => "");
    const asked = rateLimitWaitMs(res.headers, errorText);
    if (asked !== null && asked > 65_000) break;
    const wait = (asked ?? 2_000 * 2 ** Math.min(attempt, 4)) + 250 + Math.random() * 750;
    if (Date.now() + wait > giveUpAt) break;
    await sleep(wait, init.signal);
  }
  if (!res.ok || !res.body) {
    const full = errorText ?? (await res.text().catch(() => ""));
    const detail = full.slice(0, 300);
    const status =
      res.status === 401 || res.status === 403 ? 401 : res.status === 429 ? 429 : res.status === 404 ? 404 : res.status === 413 ? 413 : 502;
    // A 429 we could not wait out (a daily limit, or a long wait) means this model is out of quota for now.
    const wait = status === 429 ? rateLimitWaitMs(res.headers, full) : null;
    const daily = status === 429 && /per day|\(TPD\)|\(RPD\)/i.test(full);
    const quota = status === 429 && (daily || (wait !== null && wait > 65_000));
    const msg =
      status === 401
        ? `${label} rejected the API key.`
        : status === 429
          ? quota
            ? `${label} has used up this plan's ${daily ? "daily" : "current"} allowance for this model. ${wait ? `It frees up in about ${Math.max(1, Math.round(wait / 60_000))} min.` : "Try again later."} To avoid this, add another free provider (e.g. GEMINI_API_KEY) or upgrade the plan.`
            : `${label} rate limit reached (free plans allow only so many tokens per minute and per day). Try again shortly.`
          : status === 413
            ? `${label}: this request is larger than your plan's per-minute token limit. Set LLM_TPM_LIMIT in .env.local to that limit.`
          : status === 404
            ? `${label}: model or endpoint not found. ${detail}`
            : `${label} error ${res.status}. ${detail}`;
    throw new LlmError(msg.trim(), status, quota ? "quota" : status === 429 ? "rate_limited" : "upstream", quota ? (wait ?? undefined) : undefined);
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
    [isOpenAi ? "max_completion_tokens" : "max_tokens"]: fitToBudget(opts, cfg.tpmLimit),
  };
  if (!isOpenAi) body.temperature = 0.5;
  if (cfg.reasoningEffort) body.reasoning_effort = atLeast(cfg.reasoningEffort, opts.minEffort);
  let stopReason: "length" | "end" = "end";
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
    if (data === "[DONE]") break;
    try {
      const j = JSON.parse(data);
      const text = j.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text) yield text;
      const finish = j.choices?.[0]?.finish_reason;
      if (finish) stopReason = finish === "length" ? "length" : "end";
      if (j.error) throw new LlmError(String(j.error.message ?? "Upstream error"), 502, "upstream");
    } catch (e) {
      if (e instanceof LlmError) throw e;
    }
  }
  opts.onStop?.(stopReason);
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
  const request = () => upstream(
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
  let res: Response;
  try {
    res = await request();
  } catch (err) {
    // Nothing listening: start Ollama on this computer and try once more.
    if (!(err instanceof LlmError) || err.code !== "network") throw err;
    const started = await startOllama(cfg.baseUrl);
    if (started === "missing") throw new LlmError("The local model needs Ollama, which isn't installed (get it from ollama.com).", 502, "network");
    if (started !== "started") throw new LlmError(`Ollama isn't running at ${cfg.baseUrl} and couldn't be started.`, 502, "network");
    res = await request();
  }
  for await (const line of lines(res.body!)) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.error) throw new LlmError(`Ollama: ${j.error}`, 502, "upstream");
      const text = j.message?.content;
      if (typeof text === "string" && text) yield text;
      if (j.done) {
        opts.onStop?.(j.done_reason === "length" ? "length" : "end");
        return;
      }
    } catch (e) {
      if (e instanceof LlmError) throw e;
    }
  }
}
