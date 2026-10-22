import { z } from "zod";
import { budgetFor } from "@/lib/server/env";
import { chooseTier } from "@/lib/lesson/routing";
import { fallbackMessage, requireLlm, sourceBudget, streamText } from "@/lib/server/llm";
import { notesContinuation, notesPrompt } from "@/lib/server/prompts";
import { dropPartHeading, nestHeadings } from "@/lib/notes/headings";
import { checkNotes, verifyEnabled } from "@/lib/server/verify";
import { documentMap, excerpt, planParts } from "@/lib/source/document";
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
    const budget = sourceBudget(tier, "notes");
    const source = body.sourceText?.trim() ? body.sourceText : undefined;

    /**
     * One request's notes, streamed; when the output hits its token limit, ask for the rest (a few times at most).
     * `make` builds the prompt for a source budget, so each model the chain falls back to gets material sized for it.
     */
    async function* write(make: (budget: number) => { system: string; user: string }, signal: AbortSignal, sofar: () => string) {
      for (let part = 0; part < 4; part++) {
        let stop = "end" as "length" | "end";
        const sized = (b: number) => {
          const { system, user } = make(b);
          return { system, messages: [{ role: "user" as const, content: part === 0 ? user : `${user}\n\n${notesContinuation(sofar())}` }] };
        };
        const notices: string[] = [];
        for await (const text of streamText({
          ...sized(budget),
          sizeFor: (cfg) => sized(budgetFor(cfg, "notes")),
          maxTokens: 14000,
          tier,
          signal,
          onStop: (r) => (stop = r),
          onFallback: (n) => notices.push(fallbackMessage(n)),
        })) {
          while (notices.length) yield { type: "notice", message: notices.shift() };
          yield { type: "text", text };
        }
        if (stop !== "length") break;
      }
    }

    // A document too long for one request is noted block by block (every page, in depth),
    // then the revision summary and exam questions are written once for the whole of it.
    let planned = budget;
    let blocks = source && source.length > budget * 1.2 ? planParts(source, budget) : [];
    if (blocks.length < 2) blocks = [];
    const firstPage = (pages: string) => Number(pages.split("-")[0]);

    type Request = { make: (b: number) => { system: string; user: string }; head?: string; nest?: number };
    /** Request k (the blocks, then the closing pass): a prompt builder for a source budget, and the heading the route writes. */
    function request(k: number): Request | undefined {
      if (!blocks.length) return k === 0 ? { make: (b) => notesPrompt({ ...body, sourceBudget: b }) } : undefined;
      if (k === blocks.length)
        return { make: (b) => notesPrompt({ ...body, sourceText: documentMap(source!, b), sourceBudget: b, scope: { closing: true } }), nest: 2 };
      if (k > blocks.length) return undefined;
      // Blocks are planned for the first model. Once the chain has moved to one that reads less
      // (a day's quota used up), the pages still to come are re-planned in smaller blocks, so they
      // are noted in full; within one request, a fallback gets a shorter excerpt of the same pages.
      const now = sourceBudget(tier, "notes");
      if (now < planned) {
        blocks = [...blocks.slice(0, k), ...planParts(source!, now, firstPage(blocks[k].pages))];
        planned = now;
      }
      const blk = blocks[k];
      return {
        make: (b) =>
          notesPrompt({
            ...body,
            sourceText: excerpt(source!, { pages: blk.pages, query: blk.title }, b),
            sourceBudget: b,
            scope: { part: k + 1, parts: blocks.length, pages: blk.pages, title: blk.title },
          }),
        head: `${k === 0 ? `# ${body.topic}\n\n` : ""}## Part ${k + 1}: ${blk.title} (pages ${blk.pages})\n\n`,
        nest: 3,
      };
    }

    return ndjson(req, async function* (signal) {
      let notes = "";
      const told = new Set<string>();
      for (let k = 0, r = request(0); r; r = request(++k)) {
        const lead = `${k > 0 ? "\n\n" : ""}${r.head ?? ""}`;
        if (lead) {
          notes += lead;
          yield { type: "text", text: lead };
        }
        const start = notes.length;
        for await (const ev of write(r.make, signal, () => notes.slice(start))) {
          if (ev.type === "notice") {
            // Each block starts down the same chain: say each switch once, not once per block.
            const key = String(ev.message).replace(/\d+/g, "#");
            if (told.has(key)) continue;
            told.add(key);
          }
          if (ev.type === "text") notes += ev.text;
          yield ev;
        }
        if (r.nest) {
          const written = notes.slice(start);
          const tidy = nestHeadings(r.head ? dropPartHeading(written) : written, r.nest);
          if (tidy !== written) {
            notes = notes.slice(0, start) + tidy;
            yield { type: "replace", text: notes };
          }
        }
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
