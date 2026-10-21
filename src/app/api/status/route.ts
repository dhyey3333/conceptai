import { llmConfig, sttConfig, supabaseConfigured, ttsConfig } from "@/lib/server/env";

/** What's configured on the server. Booleans and names only, never keys. */
export async function GET() {
  const llm = llmConfig();
  const tts = ttsConfig();
  return Response.json({
    llm: llm ? { configured: true, provider: llm.provider, model: llm.model } : { configured: false },
    tts: tts ? { configured: true, provider: tts.provider } : { configured: false },
    stt: { configured: !!sttConfig() },
    supabase: { configured: supabaseConfigured() },
  });
}
