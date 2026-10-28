import { z } from "zod";
import { cleanText, sanitizeBeat, type Beat } from "@/lib/board/schema";
import { speakable } from "@/lib/math/render";
import { errorResponse, LanguageSchema, rateLimit, readJson, RequestError } from "@/lib/server/http";
import { helperVideo } from "@/lib/server/video";

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  language: LanguageSchema,
  parts: z
    .array(z.object({ title: z.string().max(200), beats: z.array(z.unknown()).max(60) }))
    .min(1)
    .max(60),
  /** Started by the app as soon as the lesson was written (so Download is instant later), not by a click. */
  auto: z.boolean().optional(),
});

/**
 * A video of a written lesson: already made (the helper keeps them, keyed by
 * the lesson's content), already being made, or started now. The client polls
 * /api/video/<job> for progress.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "video", 6);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 2_000_000);
    // The lesson comes from the browser's storage, so it is validated like anything else before it is drawn.
    const parts = body.parts
      .map((p) => ({
        title: cleanText(p.title, 200) || "Part",
        beats: p.beats
          .map((b) => sanitizeBeat(b))
          .filter((b): b is Beat => !!b)
          .map((b) => ({ say: b.say, speech: speakable(b.say).slice(0, 1200), draw: b.draw, point: b.point ?? null })),
      }))
      .filter((p) => p.beats.length);
    if (!parts.length) throw new RequestError("This lesson has nothing to record yet.");
    if (parts.reduce((n, p) => n + p.beats.length, 0) > 400) throw new RequestError("The lesson is too long for one video.", 413);
    // The helper records this app's own /render page, on this computer.
    const appUrl = `http://127.0.0.1:${new URL(req.url).port || "3100"}`;
    return await helperVideo("/video/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson: { title: cleanText(body.title, 200), language: body.language, parts }, appUrl, auto: body.auto === true }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
