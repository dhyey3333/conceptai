/**
 * Real output for the Python a lesson shows.
 *
 * Each Python "code" item is run by the local helper as its beat is written,
 * and the board shows what it actually printed (or the error, and on which
 * line). Snippets in one lesson part run like notebook cells, in order in one
 * namespace, so a class written in beat 3 can be used in beat 5. Whatever the
 * model writes about a run is discarded: only the helper's result is shown.
 */
import type { Beat, BoardItem, CodeRun } from "@/lib/board/schema";
import { runPython, type PythonRun } from "./helper";

type CodeItem = Extract<BoardItem, { type: "code" }>;
const isPython = (d: BoardItem): d is CodeItem => d.type === "code" && d.lang === "python";

function toRun(r: PythonRun): CodeRun | undefined {
  // Refused (not allowed to run): no result is better than an unverified one.
  if (r.refused) return undefined;
  return { ok: r.ok, output: r.output.slice(0, 2000), ...(r.error ? { error: r.error.slice(0, 300) } : {}), ...(r.line ? { line: r.line } : {}) };
}

export class CodeRunner {
  /** The part's Python so far, replayed before each new snippet. */
  private cells: string[] = [];

  /** The beat with the real result on each of its Python items (copied; the input is not changed). */
  async attach(beat: Beat): Promise<Beat> {
    if (!beat.draw.some((d) => d.type === "code")) return beat;
    const draw = beat.draw.map((d) => {
      if (d.type !== "code") return d;
      const { run: _ignored, ...rest } = d;
      return rest as CodeItem;
    });
    const mine = draw.filter(isPython);
    if (mine.length) {
      const results = await runPython([...this.cells, ...mine.map((d) => d.code)]);
      const own = results?.slice(-mine.length);
      mine.forEach((d, k) => {
        const run = own?.[k] && toRun(own[k]);
        if (run) d.run = run;
        // A refused snippet never ran, so later snippets don't build on it.
        if (!own?.[k]?.refused) this.cells.push(d.code);
      });
    }
    return { ...beat, draw };
  }
}

/** What the runs showed, for the fact-check: failures to fix, and real output the lesson must agree with. */
export function codeFindings(beats: Beat[], first = 0): string[] {
  const out: string[] = [];
  beats.forEach((b, i) =>
    b.draw.forEach((d) => {
      if (d.type !== "code" || !d.run) return;
      if (!d.run.ok) {
        out.push(`[beat ${first + i}] This Python code FAILS when actually run: ${d.run.error}${d.run.line ? ` (line ${d.run.line})` : ""}. Fix the code so it runs and still teaches the same thing.`);
      } else {
        const printed = d.run.output.trim();
        out.push(`[beat ${first + i}] This Python code was actually run; it prints ${printed ? JSON.stringify(printed.slice(0, 500)) : "nothing"}. Narration and board items that state what it outputs must match this.`);
      }
    }),
  );
  return out;
}
