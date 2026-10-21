import { z } from "zod";
import { chooseTier } from "@/lib/lesson/routing";
import { extractJsonObject } from "@/lib/stream/jsonObjects";
import { sanitizeQuiz } from "@/lib/quiz/schema";
import { completeText, isRetriable, LlmError } from "@/lib/server/llm";
import { quizPrompt } from "@/lib/server/prompts";
import { checkQuiz } from "@/lib/server/verify";
import { errorResponse, LevelSchema, rateLimit, readJson, ResearchTextSchema, TierSchema, TopicSchema } from "@/lib/server/http";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  outline: z.string().max(6000).optional(),
  recent: z.string().max(8000).optional(),
  tier: TierSchema,
  research: ResearchTextSchema,
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "quiz", 12);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 60_000);
    const tier = body.tier ?? chooseTier("auto", body.level);
    const { system, user } = quizPrompt(body);
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = await completeText({ system, messages: [{ role: "user", content: user }], maxTokens: 5000, json: true, tier, signal: req.signal });
      } catch (err) {
        if (attempt === 0 && isRetriable(err)) continue;
        throw err;
      }
      const quiz = sanitizeQuiz(extractJsonObject(text));
      if (!quiz) continue;
      // A wrong answer key misleads more than anything else, so it is re-solved before the quiz is shown.
      const subject = { topic: body.topic, level: body.level, research: body.research, context: "This is a practice quiz with its answer key." };
      const checked = await checkQuiz(subject, quiz, { tier, signal: req.signal });
      return Response.json({ quiz: checked.quiz, checked: checked.checked, fixes: checked.fixes });
    }
    throw new LlmError("The model didn't return usable questions. Please try again.", 502, "bad_output");
  } catch (err) {
    return errorResponse(err);
  }
}
