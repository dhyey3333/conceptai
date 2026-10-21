/**
 * Server-side configuration. API keys are read here and only here; route
 * handlers pass them to provider calls and never echo them back. The client
 * only learns *whether* a capability is configured (see /api/status).
 */

export type LlmProvider = "anthropic" | "openai" | "ollama";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  effort: "low" | "medium" | "high";
  fallbacks: boolean;
}

const env = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export function llmConfig(): LlmConfig | null {
  let provider = env("LLM_PROVIDER")?.toLowerCase() as LlmProvider | undefined;
  if (provider && !["anthropic", "openai", "ollama"].includes(provider)) provider = "openai";
  if (!provider) {
    if (env("ANTHROPIC_API_KEY")) provider = "anthropic";
    else if (env("OPENAI_API_KEY")) provider = "openai";
    else return null;
  }

  const effortRaw = env("ANTHROPIC_EFFORT")?.toLowerCase();
  const effort = effortRaw === "low" || effortRaw === "high" ? effortRaw : "medium";
  const jsonMode = env("LLM_JSON_MODE")?.toLowerCase() !== "false";

  if (provider === "anthropic") {
    const apiKey = env("LLM_API_KEY") ?? env("ANTHROPIC_API_KEY");
    if (!apiKey && !env("ANTHROPIC_AUTH_TOKEN")) return null;
    return {
      provider,
      apiKey,
      baseUrl: env("LLM_BASE_URL") ?? "",
      model: env("LLM_MODEL") ?? "claude-opus-5-5",
      jsonMode,
      effort,
      fallbacks: env("ANTHROPIC_FALLBACKS")?.toLowerCase() !== "off",
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      apiKey: env("LLM_API_KEY"),
      // Accept both http://host:11434 and the OpenAI-style http://host:11434/v1.
      baseUrl: (env("LLM_BASE_URL") ?? env("OLLAMA_HOST") ?? "http://localhost:11434").replace(/\/v1\/?$/, "").replace(/\/$/, ""),
      model: env("LLM_MODEL") ?? "llama3.1",
      jsonMode,
      effort,
      fallbacks: false,
    };
  }

  const baseUrl = (env("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = env("LLM_API_KEY") ?? env("OPENAI_API_KEY");
  // A key is required for hosted APIs; local OpenAI-compatible servers often need none.
  const isLocal = /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(baseUrl);
  if (!apiKey && !isLocal) return null;
  return {
    provider: "openai",
    apiKey,
    baseUrl,
    model: env("LLM_MODEL") ?? "gpt-4o-mini",
    jsonMode,
    effort,
    fallbacks: false,
  };
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
