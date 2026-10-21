import { z } from "zod";
import { chooseTier } from "@/lib/lesson/routing";
import { fallbackMessage, requireLlm, sourceBudget, streamText } from "@/lib/server/llm";
import { notesContinuation, notesPrompt } from "@/lib/server/prompts";
import { checkNotes, verifyEnabled } from "@/lib/server/verify";
import { errorResponse, LevelSchema, ndjson, rateLimit, readJson, ResearchTextSchema, SourceSchema, TierSchema, TopicSchema } from "@/lib/server/http";

const Body = z.object({
  topic: TopicSchema,
  level: LevelSchema,
  marks: z
    .array(z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(15)]))
    .min(1)
    .max(4),
  outline: z.string().max(6000).optional(),
  sourceText: SourceSchema,
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
    const body = await readJson(req, Body, 1_000_000);
    // Standalone notes have no lesson tier yet: pick one from the level.
    const tier = body.tier ?? chooseTier("auto", body.level);
    requireLlm(tier);
    const { system, user } = notesPrompt({ ...body, sourceBudget: sourceBudget(tier, "notes") });
    return ndjson(req, async function* (signal) {
      let notes = "";
      // When the output hits its token limit, ask for the rest (a few times at most).
      for (let part = 0; part < 4; part++) {
        let stop = "end" as "length" | "end";
        const content = part === 0 ? user : `${user}\n\n${notesContinuation(notes)}`;
        const notices: string[] = [];
        for await (const text of streamText({
          system,
          messages: [{ role: "user", content }],
          maxTokens: 14000,
          tier,
          signal,
          onStop: (r) => (stop = r),
          onFallback: (n) => notices.push(fallbackMessage(n)),
        })) {
          while (notices.length) yield { type: "notice", message: notices.shift() };
          notes += text;
          yield { type: "text", text };
        }
        if (stop !== "length") break;
      }
      if (!verifyEnabled() || !notes.trim()) {
        yield { type: "done", chars: notes.length };
        return;
      }
      // The notes are already on screen; the check replaces them with a corrected copy if it finds errors.
      yield { type: "checking" };
      const subject = { topic: body.topic, level: body.level, research: body.research, context: "These are exam notes with model answers." };
      const checked = await checkNotes(subject, notes, { tier, signal });
      if (checked.fixes) yield { type: "replace", text: checked.content };
      yield { type: "done", chars: checked.content.length, checked: checked.checked, fixes: checked.fixes };
    });
  } catch (err) {
    return errorResponse(err);
  }
}
