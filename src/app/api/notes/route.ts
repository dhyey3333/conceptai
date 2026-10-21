import { z } from "zod";
import { requireLlm, streamText } from "@/lib/server/llm";
import { notesPrompt } from "@/lib/server/prompts";
import { errorResponse, LevelSchema, ndjson, rateLimit, readJson, TopicSchema } from "@/lib/server/http";

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
});

/** Streams Markdown as {"type":"text","text":"..."} events so the editor fills in live. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "notes", 10);
  if (limited) return limited;
  try {
    requireLlm();
    const body = await readJson(req, Body, 140_000);
    const { system, user } = notesPrompt(body);
    return ndjson(req, async function* (signal) {
      let chars = 0;
      for await (const text of streamText({ system, messages: [{ role: "user", content: user }], maxTokens: 14000, signal })) {
        chars += text.length;
        yield { type: "text", text };
      }
      yield { type: "done", chars };
    });
  } catch (err) {
    return errorResponse(err);
  }
}
