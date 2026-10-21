import { beatsFromObject, type Beat, type SanitizeReport } from "@/lib/board/schema";
import { JsonObjectStream, parseLooseJson } from "@/lib/stream/jsonObjects";
import { fallbackMessage, streamText, type FallbackNotice, type GenOptions } from "./llm";
import type { StreamEvent } from "./http";

/** Remove item types a context doesn't allow (answers mid-lesson must not open a new section). */
function without(beat: Beat, drop: Set<string>): Beat | null {
  if (!drop.size) return beat;
  const draw = beat.draw.filter((it) => !drop.has(it.type));
  return beat.say || draw.length ? { ...beat, draw } : null;
}

/**
 * Run a generation and yield validated beats as soon as each one is complete.
 * Anything the model writes that isn't a valid beat is dropped and counted.
 */
export async function* streamBeats(opts: GenOptions, maxBeats = 12, dropTypes: string[] = []): AsyncGenerator<StreamEvent> {
  const drop = new Set(dropTypes);
  const parser = new JsonObjectStream();
  const report: SanitizeReport = { dropped: 0, reasons: [] };
  let count = 0;
  let raw = "";
  // Tell the student when a stand-in model takes over (and why it may be slower).
  const notices: StreamEvent[] = [];
  const onFallback = (n: FallbackNotice) => notices.push({ type: "notice", message: fallbackMessage(n), local: n.local });
  for await (const chunk of streamText({ ...opts, json: true, onFallback })) {
    while (notices.length) yield notices.shift()!;
    raw += chunk;
    for (const objText of parser.push(chunk)) {
      const obj = parseLooseJson(objText);
      if (obj === undefined) {
        report.dropped++;
        report.reasons?.push("unreadable JSON");
        continue;
      }
      for (const parsed of beatsFromObject(obj, report)) {
        const beat = without(parsed, drop);
        if (!beat) continue;
        if (count >= maxBeats) break;
        count++;
        yield { type: "beat", beat };
      }
    }
  }
  if (count === 0) {
    // Last resort: the model wrapped everything in a way the incremental parser missed.
    const whole = parseLooseJson(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    for (const parsed of beatsFromObject(whole, report).slice(0, maxBeats)) {
      const beat = without(parsed, drop);
      if (!beat) continue;
      count++;
      yield { type: "beat", beat };
    }
  }
  if (count === 0) console.warn(`[conceptai] no usable beats; the model wrote ${raw.length} chars:`, raw.slice(0, 600));
  // Which board items failed validation (type and field only, never content), to find gaps in the vocabulary.
  if (report.dropped) console.warn(`[conceptai] dropped ${report.dropped} board item(s): ${report.reasons?.join(", ")}`);
  yield { type: "done", beats: count, dropped: report.dropped };
}
