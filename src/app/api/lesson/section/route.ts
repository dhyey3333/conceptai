import { z } from "zod";
import { streamBeats } from "@/lib/server/beats";
import { verifyEnabled, writeThenCheck } from "@/lib/server/verify";
import { sectionPrompt } from "@/lib/server/prompts";
import { requireLlm, sourceBudget } from "@/lib/server/llm";
import {
  DepthSchema,
  errorResponse,
  LanguageSchema,
  LevelSchema,
  ndjson,
  OutlineSchema,
  rateLimit,
  readJson,
  RequestError,
  ResearchTextSchema,
  SourceSchema,
  TierSchema,
  TopicSchema,
} from "@/lib/server/http";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  language: LanguageSchema,
  depth: DepthSchema,
  outline: OutlineSchema,
  sectionIndex: z.number().int().min(0).max(399),
  sourceText: SourceSchema,
  tier: TierSchema,
  research: ResearchTextSchema,
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "section", 40);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 1_000_000);
    requireLlm(body.tier);
    if (body.sectionIndex >= body.outline.sections.length) throw new RequestError("sectionIndex is out of range.");
    const { system, user } = sectionPrompt({ ...body, sourceBudget: sourceBudget(body.tier, "part") });
    const section = body.outline.sections[body.sectionIndex];
    const subject = {
      topic: body.topic,
      level: body.level,
      research: body.research,
      context: `Lesson: ${body.outline.title}. Part ${body.sectionIndex + 1}: "${section.title}". Goal: ${section.goal}`,
    };
    // Beats go to the board as they are written (the lesson starts at once);
    // the fact-check runs straight after and sends corrections, which usually
    // land long before the corrected beat is played. With the check on, the
    // careful thinking happens there, so the writer keeps its usual (quicker)
    // effort: on small per-minute token budgets, long reasoning would crowd
    // out the lesson itself.
    const minEffort = verifyEnabled() ? undefined : "medium";
    return ndjson(req, (signal) =>
      writeThenCheck(
        streamBeats({ system, messages: [{ role: "user", content: user }], maxTokens: 6000, tier: body.tier, minEffort, signal }, 12),
        subject,
        { tier: body.tier, signal },
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
