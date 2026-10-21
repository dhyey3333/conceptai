import { generateSequentially, llmConfig, researchMode, sttConfig, supabaseConfigured, ttsConfig } from "@/lib/server/env";

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
        }
      : { configured: false },
    tts: tts ? { configured: true, provider: tts.provider } : { configured: false },
    stt: { configured: !!sttConfig() },
    supabase: { configured: supabaseConfigured() },
  });
}
