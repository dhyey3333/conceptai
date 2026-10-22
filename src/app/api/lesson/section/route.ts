import { z } from "zod";
import { streamBeats } from "@/lib/server/beats";
import { verifyEnabled, writeThenCheck } from "@/lib/server/verify";
import { workedExample } from "@/lib/server/helper";
import { sectionPrompt } from "@/lib/server/prompts";
import { budgetFor } from "@/lib/server/env";
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
  /** false: skip the Python tools (worked-example traces, exact maths checks), e.g. to measure their effect. */
  helper: z.boolean().optional(),
});

/**
 * A real run of the algorithm this part teaches, from the Python helper: when
 * its title or goal names one, or when it's a worked example in a lesson about one.
 */
async function workedExampleFor(topic: string, section: { title: string; goal: string }): Promise<string | undefined> {
  const own = `${section.title}\n${section.goal}`;
  return (await workedExample(own)) ?? (/example|trace|walk|in action|step|demo|illustrat/i.test(own) ? await workedExample(`${topic}\n${own}`) : undefined);
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "section", 40);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 1_000_000);
    requireLlm(body.tier);
    if (body.sectionIndex >= body.outline.sections.length) throw new RequestError("sectionIndex is out of range.");
    const section = body.outline.sections[body.sectionIndex];
    const helper = body.helper !== false;
    // The writer narrates the computed steps, and the fact-check holds the part to them.
    const worked = helper ? await workedExampleFor(body.topic, section) : undefined;
    // Built per model: a fallback with a small per-minute limit (or a local model) gets a shorter excerpt.
    const sized = (budget: number) => {
      const { system, user } = sectionPrompt({ ...body, sourceBudget: budget, worked });
      return { system, messages: [{ role: "user" as const, content: user }] };
    };
    const subject = {
      topic: body.topic,
      level: body.level,
      research: body.research,
      context: `Lesson: ${body.outline.title}. Part ${body.sectionIndex + 1}: "${section.title}". Goal: ${section.goal}`,
      reference: worked,
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
        streamBeats({ ...sized(sourceBudget(body.tier, "part")), sizeFor: (cfg) => sized(budgetFor(cfg, "part")), maxTokens: 6000, tier: body.tier, minEffort, signal }, 12),
        subject,
        { tier: body.tier, signal, helper },
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
