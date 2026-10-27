import { z } from "zod";
import { ttsConfig } from "@/lib/server/env";
import { BASE, localVoice } from "@/lib/server/helper";
import { errorResponse, jsonError, LanguageSchema, rateLimit, readJson } from "@/lib/server/http";

const Body = z.object({ text: z.string().trim().min(1).max(1200), language: LanguageSchema.optional() });

/**
 * AI voice for the teacher: a cloud voice when one is configured, otherwise the
 * free offline voice made by the Python helper (once it has been downloaded).
 * Returns audio; the client falls back to browser speech on any error.
 */
export async function POST(req: Request) {
  const cfg = ttsConfig();
  if (!cfg && (await localVoice()) !== "ready") return jsonError(503, "tts_not_configured", "No AI voice ready; using the browser voice.");
  const limited = rateLimit(req, "tts", 120);
  if (limited) return limited;
  try {
    const { text, language } = await readJson(req, Body, 10_000);
    if (!cfg) {
      const local = await fetch(`${BASE}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: language ?? "english" }),
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]),
      });
      if (!local.ok || !local.body) return jsonError(502, "tts_failed", `Offline voice error ${local.status}.`);
      return new Response(local.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    }
    const upstream =
      cfg.provider === "elevenlabs"
        ? await fetch(`${cfg.baseUrl}/text-to-speech/${encodeURIComponent(cfg.voice)}?output_format=mp3_44100_128`, {
            method: "POST",
            headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify({ text, model_id: cfg.model }),
            signal: req.signal,
          })
        : await fetch(`${cfg.baseUrl}/audio/speech`, {
            method: "POST",
            headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: cfg.model,
              voice: cfg.voice,
              input: text,
              response_format: "mp3",
              // gpt-4o-mini-tts takes speaking-style instructions; other models ignore unknown fields.
              ...(cfg.model.includes("gpt-4o") ? { instructions: "Speak like a warm, energetic teacher explaining to a student." } : {}),
            }),
            signal: req.signal,
          });
    if (!upstream.ok || !upstream.body) {
      return jsonError(502, "tts_failed", `Voice service error ${upstream.status}.`);
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
