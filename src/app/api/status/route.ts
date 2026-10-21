import { generateSequentially, llmConfig, providerChain, researchMode, sttConfig, supabaseConfigured, ttsConfig } from "@/lib/server/env";
import { currentConfigProblem } from "@/lib/server/llm";

/** What's configured on the server. Names only, never keys. */
export async function GET() {
  const best = llmConfig("best");
  const fast = llmConfig("fast");
  const tts = ttsConfig();
  return Response.json({
    llm: best
      ? {
          configured: true,
          provider: best.provider,
          model: best.model,
          // Present only when easy topics go to a different (cheaper) model.
          fast: fast && (fast.model !== best.model || fast.provider !== best.provider) ? { provider: fast.provider, model: fast.model } : undefined,
          research: researchMode(),
          sequential: generateSequentially(),
          // The model that takes over when the main one can't answer, and any setup mistake seen.
          fallback: providerChain().flatMap((l) => l.configs.map((c) => c.model)).slice(1).join(" → ") || undefined,
          problem: currentConfigProblem(),
        }
      : { configured: false },
    tts: tts ? { configured: true, provider: tts.provider } : { configured: false },
    stt: { configured: !!sttConfig() },
    supabase: { configured: supabaseConfigured() },
  });
}
