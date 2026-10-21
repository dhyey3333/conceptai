import { z } from "zod";
import { cleanText } from "@/lib/board/schema";
import { extractJsonObject } from "@/lib/stream/jsonObjects";
import { completeText, isRetriable, LlmError } from "@/lib/server/llm";
import { outlinePrompt } from "@/lib/server/prompts";
import { DepthSchema, errorResponse, LanguageSchema, LevelSchema, rateLimit, readJson, SourceSchema, TopicSchema } from "@/lib/server/http";
import type { Outline } from "@/lib/lesson/types";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  language: LanguageSchema,
  depth: DepthSchema,
  sourceText: SourceSchema,
});

function toOutline(raw: unknown, topic: string): Outline | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sectionsRaw = Array.isArray(r.sections) ? r.sections : Array.isArray(r.outline) ? r.outline : [];
  const sections = sectionsRaw
    .map((s, i) => {
      const o = (typeof s === "string" ? { title: s } : s) as Record<string, unknown>;
      const title = cleanText(String(o?.title ?? o?.name ?? ""), 120);
      const goal = cleanText(String(o?.goal ?? o?.description ?? o?.summary ?? ""), 400);
      return title ? { id: `s${i + 1}`, title, goal: goal || title } : null;
    })
    .filter((s): s is NonNullable<typeof s> => !!s)
    .slice(0, 8);
  if (sections.length < 2) return null;
  return {
    title: cleanText(String(r.title ?? topic), 120) || topic,
    subject: cleanText(String(r.subject ?? ""), 60) || "General",
    summary: cleanText(String(r.summary ?? ""), 400),
    objectives: (Array.isArray(r.objectives) ? r.objectives : [])
      .map((o) => cleanText(String(o), 200))
      .filter(Boolean)
      .slice(0, 5),
    sections,
  };
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "outline", 12);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body);
    const { system, user } = outlinePrompt(body);
    // One retry: small models occasionally return malformed JSON.
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        text = await completeText({ system, messages: [{ role: "user", content: user }], maxTokens: 2000, json: true, signal: req.signal });
      } catch (err) {
        if (attempt === 0 && isRetriable(err)) continue;
        throw err;
      }
      const outline = toOutline(extractJsonObject(text), body.topic);
      if (outline) return Response.json({ outline });
    }
    throw new LlmError("The model didn't return a usable lesson plan. Please try again.", 502, "bad_output");
  } catch (err) {
    return errorResponse(err);
  }
}
