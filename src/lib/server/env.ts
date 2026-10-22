/**
 * Server-side configuration. API keys are read here and only here; route
 * handlers pass them to provider calls and never echo them back. The client
 * only learns *whether* a capability is configured (see /api/status).
 */

import type { Tier } from "@/lib/lesson/routing";

export type { Tier };
export type LlmProvider = "anthropic" | "openai" | "ollama";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  effort: "low" | "medium" | "high";
  fallbacks: boolean;
  /** Tokens-per-minute budget of a rate-limited plan (e.g. Groq free tier): requests are sized to fit. */
  tpmLimit?: number;
  /** reasoning_effort for OpenAI-compatible reasoning models (gpt-oss): low | medium | high. */
  reasoningEffort?: string;
  /** How long to wait out a per-minute rate limit before giving up (shorter when another model can take over). */
  patienceMs?: number;
}

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

/**
 * Two model tiers. "best" (LLM_*) teaches college and advanced material and
 * does the web research; "fast" (LLM_FAST_*) handles school-level topics at a
 * fraction of the cost. On Claude the fast tier defaults to Sonnet; with any
 * other single provider both tiers are the same model.
 */

const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "ollama"];

function parseProvider(v: string | undefined): LlmProvider | undefined {
  const p = v?.toLowerCase();
  if (!p) return undefined;
  return (PROVIDERS as string[]).includes(p) ? (p as LlmProvider) : "openai";
}

function buildConfig(provider: LlmProvider, o: { apiKey?: string; baseUrl?: string; model?: string; jsonMode?: boolean }): LlmConfig | null {
  const effortRaw = env("ANTHROPIC_EFFORT")?.toLowerCase();
  const effort = effortRaw === "low" || effortRaw === "high" ? effortRaw : "medium";
  const jsonMode = o.jsonMode ?? env("LLM_JSON_MODE")?.toLowerCase() !== "false";

  if (provider === "anthropic") {
    const apiKey = o.apiKey ?? env("ANTHROPIC_API_KEY");
    if (!apiKey && !env("ANTHROPIC_AUTH_TOKEN")) return null;
    return {
      provider,
      apiKey,
      baseUrl: o.baseUrl ?? "",
      model: o.model ?? "claude-opus-5-5",
      jsonMode,
      effort,
      fallbacks: env("ANTHROPIC_FALLBACKS")?.toLowerCase() !== "off",
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      apiKey: o.apiKey,
      // Accept both http://host:11434 and the OpenAI-style http://host:11434/v1.
      baseUrl: (o.baseUrl ?? env("OLLAMA_HOST") ?? "http://localhost:11434").replace(/\/v1\/?$/, "").replace(/\/$/, ""),
      model: o.model ?? "llama3.1",
      jsonMode,
      effort,
      fallbacks: false,
    };
  }

  const baseUrl = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = o.apiKey ?? env("OPENAI_API_KEY");
  // A key is required for hosted APIs; local OpenAI-compatible servers often need none.
  const isLocal = /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(baseUrl);
  if (!apiKey && !isLocal) return null;
  return {
    provider: "openai",
    apiKey,
    baseUrl,
    model: o.model ?? "gpt-4o-mini",
    jsonMode,
    effort,
    fallbacks: false,
    tpmLimit: Number(env("LLM_TPM_LIMIT")) || undefined,
    reasoningEffort: env("LLM_REASONING_EFFORT")?.toLowerCase(),
  };
}

/** The provider configured with LLM_* (e.g. Groq). */
function mainConfig(): LlmConfig | null {
  let provider = parseProvider(env("LLM_PROVIDER"));
  if (!provider) {
    if (env("ANTHROPIC_API_KEY")) provider = "anthropic";
    else if (env("OPENAI_API_KEY")) provider = "openai";
    else return null;
  }
  return buildConfig(provider, { apiKey: env("LLM_API_KEY"), baseUrl: env("LLM_BASE_URL"), model: env("LLM_MODEL") });
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

/**
 * One provider in the chain: its models in the order they're tried (the
 * first teaches), and the model that fact-checks on it (VERIFY_MODEL).
 */
export interface ProviderLink {
  configs: LlmConfig[];
  verifyModel?: string;
}

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Google's Gemini API, free tier, when GEMINI_API_KEY is set: first in the
 * chain, because its per-minute budget is ~30x a free Groq plan's, so long
 * documents fit. Its JSON mode isn't the plain kind, so ConceptAI parses.
 */
function geminiLink(): ProviderLink | null {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) return null;
  const models = list(env("GEMINI_MODELS") ?? "gemini-3.8-flash,gemini-3.5-flash-lite");
  const base = buildConfig("openai", { apiKey, baseUrl: env("GEMINI_BASE_URL") ?? GEMINI_BASE, model: models[0], jsonMode: false })!;
  const reasoningEffort = env("GEMINI_REASONING_EFFORT")?.toLowerCase() ?? "low";
  return { configs: models.map((model) => ({ ...base, model, tpmLimit: undefined, reasoningEffort })), verifyModel: env("GEMINI_VERIFY_MODEL") };
}

/** The LLM_* provider, with LLM_FALLBACK_MODELS (same provider) after its main model. */
function mainLink(): ProviderLink | null {
  const main = mainConfig();
  if (!main) return null;
  const models = [main.model, ...list(env("LLM_FALLBACK_MODELS")).filter((m) => m !== main.model)];
  return { configs: models.map((model) => ({ ...main, model })), verifyModel: env("LLM_VERIFY_MODEL") };
}

/**
 * A further provider (LLM_FALLBACK_*, LLM_FALLBACK2_*, LLM_FALLBACK3_*):
 * PROVIDER, MODEL (comma-separated), BASE_URL, API_KEY, and its own plan
 * (TPM_LIMIT, REASONING_EFFORT, JSON_MODE, VERIFY_MODEL); nothing is inherited.
 * JSON mode defaults on, which keeps small local models valid.
 */
function fallbackLink(prefix: string): ProviderLink | null {
  const provider = parseProvider(env(`${prefix}PROVIDER`));
  if (!provider) return null;
  const models = list(env(`${prefix}MODEL`));
  const cfg = buildConfig(provider, {
    apiKey: env(`${prefix}API_KEY`),
    baseUrl: env(`${prefix}BASE_URL`),
    model: models[0],
    jsonMode: env(`${prefix}JSON_MODE`)?.toLowerCase() !== "false",
  });
  if (!cfg) return null;
  const own = { tpmLimit: Number(env(`${prefix}TPM_LIMIT`)) || undefined, reasoningEffort: env(`${prefix}REASONING_EFFORT`)?.toLowerCase() };
  return { configs: (models.length ? models : [cfg.model]).map((model) => ({ ...cfg, ...own, model })), verifyModel: env(`${prefix}VERIFY_MODEL`) };
}

/**
 * Every provider, in the order they're tried: Gemini (if its key is set),
 * the LLM_* provider, then LLM_FALLBACK_*, LLM_FALLBACK2_*, LLM_FALLBACK3_*.
 * Each has its own free allowance, so together they last much longer, and a
 * local model at the end means lessons never stop.
 */
export function providerChain(): ProviderLink[] {
  return [geminiLink(), mainLink(), ...["LLM_FALLBACK_", "LLM_FALLBACK2_", "LLM_FALLBACK3_"].map(fallbackLink)].filter(
    (l): l is ProviderLink => !!l,
  );
}

/** The model that teaches when everything is available: the first of the chain. */
function bestConfig(): LlmConfig | null {
  return providerChain()[0]?.configs[0] ?? null;
}

function fastConfig(best: LlmConfig): LlmConfig | null {
  const provider = parseProvider(env("LLM_FAST_PROVIDER"));
  const model = env("LLM_FAST_MODEL");
  if (!provider && !model) {
    // Claude default: Sonnet teaches the easy topics, unless the main model is already Sonnet or Haiku.
    return best.provider === "anthropic" && !/sonnet|haiku/.test(best.model) ? { ...best, model: "claude-sonnet-5-5" } : null;
  }
  if (!provider || provider === best.provider) {
    return {
      ...best,
      model: model ?? best.model,
      apiKey: env("LLM_FAST_API_KEY") ?? best.apiKey,
      baseUrl: env("LLM_FAST_BASE_URL") ?? best.baseUrl,
    };
  }
  return buildConfig(provider, { apiKey: env("LLM_FAST_API_KEY"), baseUrl: env("LLM_FAST_BASE_URL"), model });
}

/**
 * Whether lesson parts and notes must be generated one at a time: a local
 * model can't run two at once, and a rate-limited plan would trip its limit.
 */
export function generateSequentially(): boolean {
  const best = bestConfig();
  return !!best && (best.provider === "ollama" || !!best.tpmLimit);
}

export function llmConfig(tier: Tier = "best"): LlmConfig | null {
  const best = bestConfig();
  if (!best || tier === "best") return best;
  return fastConfig(best) ?? best;
}

/**
 * How many characters of uploaded material fit in one request to this model:
 * the lesson plan's page map, one lesson part's pages, or the notes'
 * material. Small on plans with a per-minute token budget (the whole request
 * must fit in it). See sourceBudget in llm.ts for the model actually answering.
 */
export function budgetFor(cfg: LlmConfig | null | undefined, use: "plan" | "part" | "notes"): number {
  // A local model is small too: a longer request needs a bigger context window, which on a
  // 6 GB laptop GPU spills into system memory and makes each part several times slower.
  const limited = !!cfg?.tpmLimit || (!!cfg && isLocal(cfg));
  return { plan: limited ? 6000 : 16000, part: limited ? 5000 : 14000, notes: limited ? 9000 : 40000 }[use];
}

/** Whether a configuration runs on this computer (or the local network's model server). */
export function isLocal(cfg: LlmConfig): boolean {
  return cfg.provider === "ollama" || /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(cfg.baseUrl);
}

/**
 * Web research before teaching: Claude's web search when the main teacher is
 * Claude, otherwise Wikipedia (free, no key). LLM_RESEARCH=off disables it.
 */
export type ResearchMode = "web" | "wikipedia" | "off";

export function researchMode(): ResearchMode {
  if (env("LLM_RESEARCH")?.toLowerCase() === "off") return "off";
  const best = bestConfig();
  if (!best) return "off";
  return best.provider === "anthropic" ? "web" : "wikipedia";
}

export interface VoiceConfig {
  provider: "openai" | "elevenlabs";
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
}

export function ttsConfig(): VoiceConfig | null {
  const provider = env("TTS_PROVIDER")?.toLowerCase();
  const apiKey = env("TTS_API_KEY") ?? (provider === "elevenlabs" ? env("ELEVENLABS_API_KEY") : env("OPENAI_API_KEY"));
  if (!provider || !apiKey) return null;
  if (provider === "elevenlabs") {
    return {
      provider,
      apiKey,
      baseUrl: (env("TTS_BASE_URL") ?? "https://api.elevenlabs.io/v1").replace(/\/$/, ""),
      model: env("TTS_MODEL") ?? "eleven_flash_v2_5",
      voice: env("TTS_VOICE") ?? "21m00Tcm4TlvDq8ikWAM",
    };
  }
  return {
    provider: "openai",
    apiKey,
    baseUrl: (env("TTS_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env("TTS_MODEL") ?? "gpt-4o-mini-tts",
    voice: env("TTS_VOICE") ?? "alloy",
  };
}

const GROQ_BASE = "https://api.groq.com/openai/v1";

/**
 * Speech-to-text for the student's questions (OpenAI-compatible
 * /audio/transcriptions). STT_PROVIDER=groq uses Groq's Whisper and, when
 * the lesson model is also on Groq, the same LLM_API_KEY: no second key.
 */
export function sttConfig(): Omit<VoiceConfig, "voice" | "provider"> | null {
  const provider = env("STT_PROVIDER")?.toLowerCase();
  if (!provider) return null;
  const groq = provider === "groq";
  const baseUrl = (env("STT_BASE_URL") ?? (groq ? GROQ_BASE : "https://api.openai.com/v1")).replace(/\/$/, "");
  const llmBase = env("LLM_BASE_URL")?.replace(/\/$/, "");
  const host = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return "";
    }
  };
  const sharedKey = llmBase && host(llmBase) === host(baseUrl) ? env("LLM_API_KEY") : undefined;
  const apiKey = env("STT_API_KEY") ?? sharedKey ?? (groq ? env("GROQ_API_KEY") : env("OPENAI_API_KEY"));
  if (!apiKey) return null;
  return { apiKey, baseUrl, model: env("STT_MODEL") ?? (groq ? "whisper-large-v3-turbo" : "whisper-1") };
}

export function supabaseConfigured(): boolean {
  return !!(env("NEXT_PUBLIC_SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}
