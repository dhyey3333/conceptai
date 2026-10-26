import { generateSequentially, llmConfig, providerChain, researchMode, sttConfig, supabaseConfigured, ttsConfig } from "@/lib/server/env";
import { activeConfig, currentConfigProblem } from "@/lib/server/llm";
import { helperState } from "@/lib/server/helper";

/** What's configured on the server. Names only, never keys. */
export async function GET() {
  // The models that will answer now: a model known to be used up for the day is skipped.
  const best = llmConfig("best") ? activeConfig("best") : null;
  const fast = llmConfig("fast") ? activeConfig("fast") : null;
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
    // Exact maths checks, algorithm traces and OCR (python/), when its helper is running.
    python: await helperState().then((state) => ({ up: state === "on", starting: state === "starting" })),
  });
}
