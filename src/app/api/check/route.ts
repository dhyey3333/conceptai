import { z } from "zod";
import { sanitizeBeat, type Beat } from "@/lib/board/schema";
import { sanitizeQuiz } from "@/lib/quiz/schema";
import { requireLlm } from "@/lib/server/llm";
import { checkBeats, checkNotes, checkQuiz, verifyEnabled } from "@/lib/server/verify";
import { errorResponse, LevelSchema, rateLimit, readJson, RequestError, ResearchTextSchema, TierSchema, TopicSchema } from "@/lib/server/http";

const common = { topic: TopicSchema, level: LevelSchema, research: ResearchTextSchema, tier: TierSchema };

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("beats"), context: z.string().max(800), beats: z.array(z.unknown()).min(1).max(12), ...common }),
  z.object({ kind: z.literal("notes"), content: z.string().min(1).max(120_000), ...common }),
  z.object({ kind: z.literal("quiz"), quiz: z.unknown(), ...common }),
]);

/**
 * Fact-check content again later: a lesson part, notes or a quiz that was
 * written while the checker was unavailable (out of quota, offline, or
 * written by the local stand-in model). Returns { checked: false } quickly if
 * the checker still can't run, so the client simply tries again later.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "check", 30);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 200_000);
    if (!verifyEnabled()) return Response.json({ checked: false, disabled: true });
    requireLlm(body.tier);
    const opts = { tier: body.tier, signal: req.signal };
    if (body.kind === "beats") {
      const beats = body.beats.map((b) => sanitizeBeat(b)).filter((b): b is Beat => !!b);
      // Fix indices refer to the client's list, so every beat must survive validation.
      if (beats.length !== body.beats.length) throw new RequestError("Some beats were not valid.");
      return Response.json(await checkBeats({ topic: body.topic, level: body.level, research: body.research, context: body.context }, beats, opts));
    }
    if (body.kind === "notes") {
      const subject = { topic: body.topic, level: body.level, research: body.research, context: "These are exam notes with model answers." };
      return Response.json(await checkNotes(subject, body.content, opts));
    }
    const quiz = sanitizeQuiz(body.quiz);
    if (!quiz) throw new RequestError("The quiz was not valid.");
    const subject = { topic: body.topic, level: body.level, research: body.research, context: "This is a practice quiz with its answer key." };
    return Response.json(await checkQuiz(subject, quiz, opts));
  } catch (err) {
    return errorResponse(err);
  }
}
