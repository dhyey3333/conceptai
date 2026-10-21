import { z } from "zod";
import { chooseTier, shouldResearch } from "@/lib/lesson/routing";
import { researchMode } from "@/lib/server/env";
import { runResearch } from "@/lib/server/research";
import {
  errorResponse,
  LevelSchema,
  ndjson,
  rateLimit,
  readJson,
  ResearchPrefSchema,
  TierPrefSchema,
  TopicSchema,
} from "@/lib/server/http";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  pref: ResearchPrefSchema,
  tierPref: TierPrefSchema,
});

/**
 * Look a topic up on the web before teaching it. Streams progress
 * ({"type":"search"}, {"type":"source"}) and ends with {"type":"done"} carrying
 * the briefing, or {"type":"skipped"} when research isn't needed or available.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "research", 12);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 10_000);
    const mode = researchMode();
    return ndjson(req, async function* (signal) {
      if (mode === "off") return yield { type: "skipped", reason: "disabled" };
      if (!shouldResearch(body.pref, body.level)) return yield { type: "skipped", reason: "not_needed" };
      let done = false;
      for await (const ev of runResearch({ topic: body.topic, level: body.level, tier: chooseTier(body.tierPref, body.level) }, signal)) {
        if (ev.type === "done") done = true;
        yield ev;
      }
      if (!done) yield { type: "skipped", reason: "no_results" };
    });
  } catch (err) {
    return errorResponse(err);
  }
}
