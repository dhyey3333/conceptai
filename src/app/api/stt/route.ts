import { sttConfig } from "@/lib/server/env";
import { errorResponse, jsonError, rateLimit } from "@/lib/server/http";

const MAX_AUDIO = 12 * 1024 * 1024;

/** Transcribe a recorded question with an OpenAI-compatible speech-to-text API. */
export async function POST(req: Request) {
  const cfg = sttConfig();
  if (!cfg) return jsonError(503, "stt_not_configured", "No AI speech recognition configured.");
  const limited = rateLimit(req, "stt", 40);
  if (limited) return limited;
  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO) return jsonError(413, "too_large", "Recording too long.");
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) return jsonError(400, "bad_request", "No audio received.");
    if (audio.size > MAX_AUDIO) return jsonError(413, "too_large", "Recording too long.");
    const language = String(form.get("language") ?? "").slice(0, 5);

    const up = new FormData();
    up.append("file", audio, "question.webm");
    up.append("model", cfg.model);
    if (/^[a-z]{2}$/.test(language)) up.append("language", language);
    const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: up,
      signal: req.signal,
    });
    if (!res.ok) return jsonError(502, "stt_failed", `Speech service error ${res.status}.`);
    const data = (await res.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim().slice(0, 1000) });
  } catch (err) {
    return errorResponse(err);
  }
}
