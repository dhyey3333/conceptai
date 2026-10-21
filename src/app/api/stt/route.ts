import { sttConfig } from "@/lib/server/env";
import { errorResponse, jsonError, rateLimit } from "@/lib/server/http";
import { rateLimitWaitMs } from "@/lib/server/llm";

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
    // The lesson topic as Whisper's prompt helps it spell technical terms ("Kalman", "eigenvalue").
    const hint = String(form.get("hint") ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 200);
    // Name the file after its real format (Chrome records webm, Safari mp4).
    const ext = /mp4|m4a|aac/.test(audio.type) ? "mp4" : /ogg/.test(audio.type) ? "ogg" : /wav/.test(audio.type) ? "wav" : "webm";

    const up = new FormData();
    up.append("file", audio, `question.${ext}`);
    up.append("model", cfg.model);
    up.append("response_format", "json");
    if (/^[a-z]{2}$/.test(language)) up.append("language", language);
    if (hint.trim()) up.append("prompt", hint);
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: up,
        signal: req.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      return jsonError(503, "stt_unreachable", "The speech service can't be reached.");
    }
    if (res.status === 429) {
      // Tell the client how long the limit lasts, so it uses the browser's recognition until then.
      const retryAfterMs = rateLimitWaitMs(res.headers, await res.text().catch(() => ""));
      return Response.json({ error: "rate_limited", message: "The speech service's limit is reached for now.", retryAfterMs }, { status: 429 });
    }
    if (!res.ok) return jsonError(502, "stt_failed", `Speech service error ${res.status}.`);
    const data = (await res.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim().slice(0, 1000) });
  } catch (err) {
    return errorResponse(err);
  }
}
