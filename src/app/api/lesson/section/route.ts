import { z } from "zod";
import { streamBeats } from "@/lib/server/beats";
import { sectionPrompt } from "@/lib/server/prompts";
import { requireLlm } from "@/lib/server/llm";
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
  sectionIndex: z.number().int().min(0).max(9),
  sourceText: SourceSchema,
  tier: TierSchema,
  research: ResearchTextSchema,
});

export async function POST(req: Request) {
  const limited = rateLimit(req, "section", 40);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 80_000);
    requireLlm(body.tier);
    if (body.sectionIndex >= body.outline.sections.length) throw new RequestError("sectionIndex is out of range.");
    const { system, user } = sectionPrompt(body);
    return ndjson(req, (signal) =>
      streamBeats({ system, messages: [{ role: "user", content: user }], maxTokens: 6000, tier: body.tier, signal }, 12),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
