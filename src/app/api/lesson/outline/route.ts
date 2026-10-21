import { z } from "zod";
import { cleanText } from "@/lib/board/schema";
import { extractJsonObject } from "@/lib/stream/jsonObjects";
import { chooseTier, escalateTier } from "@/lib/lesson/routing";
import { llmConfig } from "@/lib/server/env";
import { completeText, isRetriable, LlmError, sourceBudget } from "@/lib/server/llm";
import { planParts } from "@/lib/source/document";
import { outlinePrompt } from "@/lib/server/prompts";
import {
  DepthSchema,
  errorResponse,
  LanguageSchema,
  LevelSchema,
  rateLimit,
  readJson,
  ResearchTextSchema,
  SourceSchema,
  TierPrefSchema,
  TopicSchema,
} from "@/lib/server/http";
import type { Outline } from "@/lib/lesson/types";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  language: LanguageSchema,
  depth: DepthSchema,
  sourceText: SourceSchema,
  tierPref: TierPrefSchema,
  research: ResearchTextSchema,
});

function toOutline(raw: unknown, topic: string): { outline: Outline; difficulty?: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sectionsRaw = Array.isArray(r.sections) ? r.sections : Array.isArray(r.outline) ? r.outline : [];
  const sections = sectionsRaw
    .map((s, i) => {
      const o = (typeof s === "string" ? { title: s } : s) as Record<string, unknown>;
      const title = cleanText(String(o?.title ?? o?.name ?? ""), 120);
      const goal = cleanText(String(o?.goal ?? o?.description ?? o?.summary ?? ""), 400);
      // Which pages of the uploaded material this part teaches from (when material was attached).
      const pagesRaw = o?.pages ?? o?.page_range ?? o?.pageRange;
      const pages = typeof pagesRaw === "string" || typeof pagesRaw === "number" ? cleanText(String(pagesRaw), 30) || undefined : undefined;
      return title ? { id: `s${i + 1}`, title, goal: goal || title, ...(pages ? { pages } : {}) } : null;
    })
    .filter((s): s is NonNullable<typeof s> => !!s)
    .slice(0, 8);
  if (sections.length < 2) return null;
  const difficulty = String(r.difficulty ?? "").toLowerCase();
  return {
    outline: {
      title: cleanText(String(r.title ?? topic), 120) || topic,
      subject: cleanText(String(r.subject ?? ""), 60) || "General",
      summary: cleanText(String(r.summary ?? ""), 400),
      objectives: (Array.isArray(r.objectives) ? r.objectives : [])
        .map((o) => cleanText(String(o), 200))
        .filter(Boolean)
        .slice(0, 5),
      sections,
    },
    difficulty: ["basic", "intermediate", "advanced"].includes(difficulty) ? difficulty : undefined,
  };
}

/**
 * Plans the lesson and decides which model teaches it: the tier the level
 * suggests, raised to the best model if the plan rates the topic advanced.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "outline", 12);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 1_000_000);
    const tier = chooseTier(body.tierPref, body.level);
    const { system, user } = outlinePrompt({ ...body, sourceBudget: sourceBudget(tier, "plan") });
    // One retry: small models occasionally return malformed JSON.
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = await completeText({ system, messages: [{ role: "user", content: user }], maxTokens: 2000, json: true, tier, signal: req.signal });
      } catch (err) {
        if (attempt === 0 && isRetriable(err)) continue;
        throw err;
      }
      const parsed = toOutline(extractJsonObject(text), body.topic);
      if (parsed) {
        const finalTier = escalateTier(body.tierPref, tier, parsed.difficulty);
        // Whole document: the parts come from the document itself, in order, so every page is
        // taught however long it is; each part is sized to be read in full by the teaching model.
        if (body.depth === "full" && body.sourceText?.trim()) {
          const parts = planParts(body.sourceText, sourceBudget(finalTier, "part"));
          if (parts.length >= 2) parsed.outline.sections = parts.map((p, i) => ({ id: `s${i + 1}`, ...p }));
        }
        return Response.json({
          outline: parsed.outline,
          difficulty: parsed.difficulty,
          tier: finalTier,
          model: llmConfig(finalTier)?.model,
        });
      }
    }
    throw new LlmError("The model didn't return a usable lesson plan. Please try again.", 502, "bad_output");
  } catch (err) {
    return errorResponse(err);
  }
}
