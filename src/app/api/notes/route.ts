import { z } from "zod";
import { chooseTier } from "@/lib/lesson/routing";
import { requireLlm, streamText } from "@/lib/server/llm";
import { notesContinuation, notesPrompt } from "@/lib/server/prompts";
import { errorResponse, LevelSchema, ndjson, rateLimit, readJson, ResearchTextSchema, TierSchema, TopicSchema } from "@/lib/server/http";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  marks: z
    .array(z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(15)]))
    .min(1)
    .max(4),
  outline: z.string().max(6000).optional(),
  sourceText: z.string().max(60_000).optional(),
  sourceNames: z.array(z.string().max(200)).max(10).optional(),
  tier: TierSchema,
  research: ResearchTextSchema,
  references: z.array(z.object({ title: z.string().max(200), url: z.string().url().max(500) })).max(10).optional(),
});

/** Streams Markdown as {"type":"text","text":"..."} events so the editor fills in live. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "notes", 10);
  if (limited) return limited;
  try {
    const body = await readJson(req, Body, 160_000);
    // Standalone notes have no lesson tier yet: pick one from the level.
    const tier = body.tier ?? chooseTier("auto", body.level);
    requireLlm(tier);
    const { system, user } = notesPrompt(body);
    return ndjson(req, async function* (signal) {
      let notes = "";
      // When the output hits its token limit, ask for the rest (a few times at most).
      for (let part = 0; part < 4; part++) {
        let stop = "end" as "length" | "end";
        const content = part === 0 ? user : `${user}\n\n${notesContinuation(notes)}`;
        for await (const text of streamText({
          system,
          messages: [{ role: "user", content }],
          maxTokens: 14000,
          tier,
          signal,
          onStop: (r) => (stop = r),
        })) {
          notes += text;
          yield { type: "text", text };
        }
        if (stop !== "length") break;
      }
      yield { type: "done", chars: notes.length };
    });
  } catch (err) {
    return errorResponse(err);
  }
}
