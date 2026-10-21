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

function buildConfig(provider: LlmProvider, o: { apiKey?: string; baseUrl?: string; model?: string }): LlmConfig | null {
  const effortRaw = env("ANTHROPIC_EFFORT")?.toLowerCase();
  const effort = effortRaw === "low" || effortRaw === "high" ? effortRaw : "medium";
  const jsonMode = env("LLM_JSON_MODE")?.toLowerCase() !== "false";

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

function bestConfig(): LlmConfig | null {
  let provider = parseProvider(env("LLM_PROVIDER"));
  if (!provider) {
    if (env("ANTHROPIC_API_KEY")) provider = "anthropic";
    else if (env("OPENAI_API_KEY")) provider = "openai";
    else return null;
  }
  return buildConfig(provider, { apiKey: env("LLM_API_KEY"), baseUrl: env("LLM_BASE_URL"), model: env("LLM_MODEL") });
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

export function sttConfig(): Omit<VoiceConfig, "voice" | "provider"> | null {
  const provider = env("STT_PROVIDER")?.toLowerCase();
  const apiKey = env("STT_API_KEY") ?? env("OPENAI_API_KEY");
  if (!provider || !apiKey) return null;
  return {
    apiKey,
    baseUrl: (env("STT_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env("STT_MODEL") ?? "whisper-1",
  };
}

export function supabaseConfigured(): boolean {
  return !!(env("NEXT_PUBLIC_SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}
