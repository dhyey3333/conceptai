import { z } from "zod";
import { streamBeats } from "@/lib/server/beats";
import { askPrompt } from "@/lib/server/prompts";
import { writeThenCheck } from "@/lib/server/verify";
import { requireLlm } from "@/lib/server/llm";
import {
  errorResponse,
  LanguageSchema,
  LevelSchema,
  ndjson,
  rateLimit,
  readJson,
  RequestError,
  ResearchTextSchema,
  TierSchema,
} from "@/lib/server/http";

const short = (n: number) => z.string().max(n);

const Body = z.object({
  context: z.object({
    topic: short(300),
    title: short(200),
    level: LevelSchema,
    language: LanguageSchema,
    outline: z.array(short(200)).max(10),
    currentSection: short(200).optional(),
    recentNarration: z.array(short(1000)).max(10),
    board: short(5000),
    chat: z.array(z.object({ role: z.enum(["user", "teacher"]), text: short(1500) })).max(8),
    research: ResearchTextSchema,
  }),
  question: short(1000),
  mode: z.enum(["question", "simpler", "example", "about"]),
  about: short(1500).optional(),
  tier: TierSchema,
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "ask", 30);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 80_000);
    requireLlm(body.tier);
    if (body.mode === "question" && !body.question.trim()) throw new RequestError("Please type or say a question.");
    const { system, user } = askPrompt(body);
    const c = body.context;
    const asked = body.mode === "simpler" ? "to explain it more simply" : body.mode === "example" ? "for another example" : `"${body.question.slice(0, 400)}"`;
    const subject = {
      topic: c.topic,
      level: c.level,
      research: c.research,
      context: `This is the teacher's answer, mid-lesson ("${c.title}"), to a student who asked ${asked}.${body.about ? `\nThey asked about: ${body.about.slice(0, 600)}` : ""}${c.board ? `\nThe board at that moment: ${c.board.slice(0, 2000)}` : ""}`,
    };
    // Answers are short but must be right, so they always get at least medium reasoning, and a check.
    return ndjson(req, (signal) =>
      writeThenCheck(
        streamBeats(
          { system, messages: [{ role: "user", content: user }], maxTokens: 3500, tier: body.tier, minEffort: "medium", signal },
          5,
          ["title", "heading"],
        ),
        subject,
        { tier: body.tier, signal },
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
