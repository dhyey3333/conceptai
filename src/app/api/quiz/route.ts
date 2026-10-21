import { z } from "zod";
import { extractJsonObject } from "@/lib/stream/jsonObjects";
import { sanitizeQuiz } from "@/lib/quiz/schema";
import { completeText, isRetriable, LlmError } from "@/lib/server/llm";
import { quizPrompt } from "@/lib/server/prompts";
import { errorResponse, LevelSchema, rateLimit, readJson, TopicSchema } from "@/lib/server/http";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  outline: z.string().max(6000).optional(),
  recent: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "quiz", 12);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 40_000);
    const { system, user } = quizPrompt(body);
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = await completeText({ system, messages: [{ role: "user", content: user }], maxTokens: 5000, json: true, signal: req.signal });
      } catch (err) {
        if (attempt === 0 && isRetriable(err)) continue;
        throw err;
      }
      const quiz = sanitizeQuiz(extractJsonObject(text));
      if (quiz) return Response.json({ quiz });
    }
    throw new LlmError("The model didn't return usable questions. Please try again.", 502, "bad_output");
  } catch (err) {
    return errorResponse(err);
  }
}
