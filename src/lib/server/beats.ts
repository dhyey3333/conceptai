import { beatsFromObject, type SanitizeReport } from "@/lib/board/schema";
import { JsonObjectStream, parseLooseJson } from "@/lib/stream/jsonObjects";
import { streamText, type GenOptions } from "./llm";
import type { StreamEvent } from "./http";

/**
 * Run a generation and yield validated beats as soon as each one is complete.
 * Anything the model writes that isn't a valid beat is dropped and counted.
 */
export async function* streamBeats(opts: GenOptions, maxBeats = 12): AsyncGenerator<StreamEvent> {
  const parser = new JsonObjectStream();
  const report: SanitizeReport = { dropped: 0 };
  let count = 0;
  let raw = "";
  for await (const chunk of streamText({ ...opts, json: true })) {
    raw += chunk;
    for (const objText of parser.push(chunk)) {
      const obj = parseLooseJson(objText);
      if (obj === undefined) {
        report.dropped++;
        continue;
      }
      for (const beat of beatsFromObject(obj, report)) {
        if (count >= maxBeats) break;
        count++;
        yield { type: "beat", beat };
      }
    }
  }
  if (count === 0) {
    // Last resort: the model wrapped everything in a way the incremental parser missed.
    const whole = parseLooseJson(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    for (const beat of beatsFromObject(whole, report).slice(0, maxBeats)) {
      count++;
      yield { type: "beat", beat };
    }
  }
  yield { type: "done", beats: count, dropped: report.dropped };
}
