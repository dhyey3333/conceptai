/**
 * Fact-check pass for everything the teacher produces.
 *
 * After a lesson part, an answer, a set of notes or a quiz is written, a second
 * request reviews it like an examiner: recomputes numbers, re-runs algorithm
 * traces, checks formulas and units, and compares every diagram with the
 * narration. It returns only what needs fixing, and corrections go through the
 * same validators as everything else.
 *
 * Board content streams to the student while it is written and the check runs
 * straight after, so it costs no waiting: corrected beats replace the
 * originals, usually before they are played. A failed or unreadable check
 * never blocks anything; the content is simply marked unchecked.
 */
import { sanitizeBeat, type Beat } from "@/lib/board/schema";
import type { Level } from "@/lib/lesson/types";
import { sanitizeQuiz, type Quiz } from "@/lib/quiz/schema";
import { extractJsonObject } from "@/lib/stream/jsonObjects";
import { completeText, LlmError } from "./llm";
import { callHelper, mathFindings, runPython } from "./helper";
import { CodeRunner, codeFindings } from "./coderun";
import { checkBeatsPrompt, checkNotesPrompt, checkQuizPrompt } from "./prompts";
import type { Tier } from "./env";
import type { StreamEvent } from "./http";

/** What was written, for whom, and in what context; the reviewer needs all three. */
export interface CheckSubject {
  topic: string;
  level: Level;
  /** One or two lines: which lesson part this is, or which question it answers. */
  context: string;
  research?: string;
  /** A real run of the algorithm being taught (Python helper): the correct steps to hold the material to. */
  reference?: string;
}

interface CheckOpts {
  tier?: Tier;
  signal: AbortSignal;
  /** false: no exact maths checks from the Python helper. */
  helper?: boolean;
}

const INLINE_MATH = /\$([^$]+)\$/g;

/** Every equation and derivation drawn in the beats, for the exact (SymPy) checks; ids are "beat.item". */
function mathItems(beats: Beat[]): { id: string; latex?: string; lines?: string[] }[] {
  const out: { id: string; latex?: string; lines?: string[] }[] = [];
  beats.forEach((b, i) =>
    b.draw.forEach((d, j) => {
      if (d.type === "math") out.push({ id: `${i}.${j}`, latex: d.latex });
      else if (d.type === "steps") out.push({ id: `${i}.${j}`, lines: d.lines.map((l) => l.latex) });
      else {
        const texts = d.type === "text" ? [d.text] : d.type === "bullets" ? d.items : d.type === "table" ? d.rows.flat() : [];
        texts.forEach((t, k) => [...t.matchAll(INLINE_MATH)].forEach((m, n) => out.push({ id: `${i}.${j}.${k}.${n}`, latex: m[1] })));
      }
    }),
  );
  return out;
}

export function verifyEnabled(): boolean {
  return process.env.LLM_VERIFY?.trim().toLowerCase() !== "off";
}

/**
 * Checking needs real thought, whatever the default effort is. Measured on a
 * heap-sort trace with planted errors: medium caught and correctly fixed all
 * of them; low either ran out of tokens or "fixed" a step into a new error.
 */
function verifyEffort(): "medium" | "high" {
  return process.env.LLM_VERIFY_EFFORT?.trim().toLowerCase() === "high" ? "high" : "medium";
}

/** Beats per check request (LLM_VERIFY_CHUNK); by default a whole part at once, split only when it doesn't fit. */
function chunkSize(): number {
  const n = Number(process.env.LLM_VERIFY_CHUNK);
  return Number.isInteger(n) && n > 0 ? n : 12;
}

/** Ask the reviewer and parse its JSON verdict; undefined means "couldn't check". */
async function review(prompt: { system: string; user: string }, opts: CheckOpts, maxTokens = 6000): Promise<{ verdict?: unknown; cutOff?: boolean }> {
  let stop = "end";
  try {
    const text = await completeText({
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      maxTokens,
      json: true,
      tier: opts.tier,
      minEffort: verifyEffort(),
      // Each provider's VERIFY_MODEL checks (e.g. one with its own rate limit), and never a
      // local stand-in: a small model "correcting" a big one does harm, so then the check is skipped.
      check: true,
      signal: opts.signal,
      onStop: (r) => (stop = r),
    });
    const verdict = extractJsonObject(text);
    if (verdict === undefined) console.warn(`[conceptai] fact-check unreadable (stop: ${stop}, ${text.length} chars):`, text.slice(0, 300));
    // Cut off by the output limit (on small per-minute budgets, reasoning can use all of it).
    return { verdict, cutOff: verdict === undefined && stop === "length" };
  } catch (err) {
    if (err instanceof LlmError && err.code === "aborted") throw err;
    console.warn("[conceptai] fact-check skipped:", err instanceof Error ? err.message : err);
    return {};
  }
}

function fixList(verdict: unknown): Record<string, unknown>[] {
  const list = typeof verdict === "object" && verdict !== null ? (verdict as { fixes?: unknown }).fixes : undefined;
  return Array.isArray(list) ? list.filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null) : [];
}

// --- board beats (lesson parts and answers) -------------------------------------

export interface BeatFix {
  index: number;
  beat: Beat;
}

/** Turn the reviewer's corrections into validated replacement beats (only for beats in [from, to)). */
export function beatFixes(beats: Beat[], verdict: unknown, from = 0, to = beats.length): BeatFix[] {
  const out = new Map<number, Beat>();
  for (const f of fixList(verdict)) {
    const i = Number(f.beat);
    if (!Number.isInteger(i) || i < from || i >= Math.min(to, beats.length)) continue;
    const before = out.get(i) ?? beats[i];
    const merged = sanitizeBeat({
      say: typeof f.say === "string" && f.say.trim() ? f.say : before.say,
      draw: Array.isArray(f.draw) ? f.draw : before.draw,
      point: before.point,
    });
    if (!merged) continue;
    // A correction that leaves nothing drawable must not wipe the original drawing.
    if (Array.isArray(f.draw) && merged.draw.length === 0 && before.draw.length > 0) merged.draw = before.draw;
    if (JSON.stringify(merged) === JSON.stringify(beats[i])) continue;
    out.set(i, merged);
  }
  return [...out].map(([index, beat]) => ({ index, beat }));
}

export async function checkBeats(subject: CheckSubject, beats: Beat[], opts: CheckOpts): Promise<{ fixes: BeatFix[]; checked: boolean }> {
  if (!beats.length) return { fixes: [], checked: false };
  const current = [...beats];
  const fixes: BeatFix[] = [];
  let checked = true;
  // Exact arithmetic and algebra (SymPy, via the Python helper): what it finds is certainly wrong.
  const exact = opts.helper === false ? [] : await mathFindings(mathItems(beats));
  const exactFor = (from: number, to: number) =>
    exact.filter((f) => Number(f.id.split(".")[0]) >= from && Number(f.id.split(".")[0]) < to).map((f) => `[beat ${f.id.split(".")[0]}] ${f.message}`);
  // Check beats [from, to); if the reviewer runs out of room, check each half instead.
  const range = async (from: number, to: number): Promise<void> => {
    // Earlier narration (already checked, with its corrections) lets the reviewer follow a trace across chunks.
    const prompt = checkBeatsPrompt({
      ...subject,
      beats: current.slice(from, to),
      first: from,
      earlier: current.slice(0, from).map((b) => b.say),
      exact: exactFor(from, to),
      runs: codeFindings(current.slice(from, to), from),
    });
    const { verdict, cutOff } = await review(prompt, opts);
    if (verdict === undefined) {
      if (cutOff && to - from > 1) {
        const mid = from + Math.ceil((to - from) / 2);
        await range(from, mid);
        return range(mid, to);
      }
      checked = false;
      return;
    }
    for (const f of beatFixes(current, verdict, from, to)) {
      current[f.index] = f.beat;
      fixes.push(f);
    }
  };
  const size = chunkSize();
  for (let from = 0; from < current.length; from += size) await range(from, Math.min(current.length, from + size));
  return { fixes, checked };
}

/** The first list of 3+ numbers a part shows (its worked example's input), from array items or written lists. */
export function exampleInput(beats: Beat[]): number[] | undefined {
  for (const b of beats) {
    for (const d of b.draw) {
      if (d.type === "array") {
        const nums = d.values.map(Number);
        if (nums.length >= 3 && nums.every(Number.isFinite)) return nums;
      }
      const m = /\[\s*(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){2,})\s*\]/.exec(JSON.stringify(d));
      if (m) return m[1].split(/\s*,\s*/).map(Number);
    }
    const m = /\[\s*(-?\d+(?:\s*,\s*-?\d+){2,})\s*\]/.exec(b.say);
    if (m) return m[1].split(/\s*,\s*/).map(Number);
  }
  return undefined;
}

/** A real run of the part's algorithm on the input the part itself used (or undefined). */
async function traceForExample(subject: CheckSubject, beats: Beat[]): Promise<string | undefined> {
  const input = exampleInput(beats);
  if (!input) return undefined;
  const r = await callHelper<{ trace: { text: string } | null }>("/trace", { text: `${subject.topic}\n${subject.context}`, input }, 3000);
  return r?.trace?.text;
}

/**
 * Pass beats through as they are written, then fact-check them all and send
 * the corrections. Events: beat* → checking → fix* → done{checked, fixes}.
 */
export async function* writeThenCheck(
  write: AsyncIterable<StreamEvent>,
  subject: CheckSubject,
  opts: CheckOpts,
): AsyncGenerator<StreamEvent> {
  const beats: Beat[] = [];
  let done: StreamEvent = { type: "done" };
  // Python on the board is run as each beat arrives, so the real output is drawn with it.
  const runner = new CodeRunner();
  for await (const ev of write) {
    if (ev.type === "done") {
      done = ev;
      continue;
    }
    if (ev.type === "beat") {
      const beat = opts.helper === false ? (ev.beat as Beat) : await runner.attach(ev.beat as Beat);
      beats.push(beat);
      yield { ...ev, beat };
      continue;
    }
    yield ev;
  }
  if (!verifyEnabled() || !beats.length) {
    yield done;
    return;
  }
  yield { type: "checking", beats: beats.length };
  // Whatever example the part actually used, the check gets the true run of the algorithm on THAT input.
  const actual = subject.reference && opts.helper !== false ? await traceForExample(subject, beats) : undefined;
  const { fixes, checked, corrections } = await checkBeatsAndCode(actual ? { ...subject, reference: actual } : subject, beats, opts);
  for (const f of fixes) yield { type: "fix", index: f.index, beat: f.beat };
  yield { ...done, checked, fixes: corrections };
}

/** Run all of a part's Python again, in order (later snippets may use earlier ones): the beats with fresh results. */
export async function rerunCode(beats: Beat[]): Promise<Beat[]> {
  const runner = new CodeRunner();
  const out: Beat[] = [];
  for (const b of beats) out.push(await runner.attach(b));
  return out;
}

/**
 * Fact-check beats whose Python has already run, then run any corrected code again.
 * Returns every beat that changed (a correction, or code whose output changed because
 * of one) and how many beats the reviewer corrected.
 */
export async function checkBeatsAndCode(
  subject: CheckSubject,
  beats: Beat[],
  opts: CheckOpts,
): Promise<{ fixes: BeatFix[]; checked: boolean; corrections: number }> {
  const { fixes, checked } = await checkBeats(subject, beats, opts);
  const final = [...beats];
  const changed = new Set<number>();
  for (const f of fixes) {
    final[f.index] = f.beat;
    changed.add(f.index);
  }
  if (opts.helper !== false && fixes.some((f) => f.beat.draw.some((d) => d.type === "code"))) {
    const fresh = await rerunCode(final);
    fresh.forEach((b, i) => {
      if (JSON.stringify(b) !== JSON.stringify(final[i])) {
        final[i] = b;
        changed.add(i);
      }
    });
  }
  return { fixes: [...changed].sort((a, b) => a - b).map((i) => ({ index: i, beat: final[i] })), checked, corrections: fixes.length };
}

// --- notes --------------------------------------------------------------------------

/** Split Markdown at headings into pieces of at most `max` characters, so each check fits a small token budget. */
export function chunkMarkdown(md: string, max = 9000): string[] {
  const blocks = md.split(/\n(?=#{1,3} )/);
  const out: string[] = [];
  let cur = "";
  for (const b of blocks) {
    if (cur && cur.length + b.length + 1 > max) {
      out.push(cur);
      cur = b;
    } else cur = cur ? `${cur}\n${b}` : b;
  }
  if (cur) out.push(cur);
  // A single huge section is still split, at paragraph breaks.
  return out.flatMap((c) => (c.length <= max * 1.5 ? [c] : c.split(/\n\n(?=\S)/).reduce<string[]>((acc, p) => {
    const last = acc.length ? acc[acc.length - 1] : undefined;
    if (last !== undefined && last.length + p.length + 2 <= max) acc[acc.length - 1] = `${last}\n\n${p}`;
    else acc.push(p);
    return acc;
  }, [])));
}

/** Apply find/replace corrections; a fix whose text isn't found exactly once is ignored rather than guessed. */
export function applyTextFixes(text: string, verdict: unknown): { text: string; fixes: number } {
  let out = text;
  let fixes = 0;
  for (const f of fixList(verdict)) {
    const find = typeof f.find === "string" ? f.find : "";
    const replace = typeof f.replace === "string" ? f.replace : undefined;
    if (find.length < 4 || replace === undefined || find === replace) continue;
    const at = out.indexOf(find);
    if (at < 0 || out.indexOf(find, at + 1) >= 0) continue;
    out = out.slice(0, at) + replace + out.slice(at + find.length);
    fixes++;
  }
  return { text: out, fixes };
}

export async function checkNotes(
  subject: CheckSubject,
  markdown: string,
  opts: CheckOpts,
): Promise<{ content: string; fixes: number; checked: boolean }> {
  let content = markdown;
  let fixes = 0;
  let checked = markdown.trim().length > 0;
  // The notes' Python blocks, run in order like notebook cells (a later block may use an earlier one).
  const blocks = opts.helper === false ? [] : [...markdown.matchAll(/```(?:python3?|py)[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const results = (await runPython(blocks)) ?? [];
  const runs = blocks.flatMap((code, i) => {
    const r = results[i];
    if (!r || r.refused) return [];
    const block = `The python block starting ${JSON.stringify(code.trim().split("\n")[0].slice(0, 80))}`;
    const out = r.output.trim();
    return [{ code, note: r.ok ? `${block} prints ${out ? JSON.stringify(out.slice(0, 500)) : "nothing"}.` : `${block} FAILS when run: ${r.error}${r.line ? ` (its line ${r.line})` : ""}.` }];
  });
  for (const chunk of chunkMarkdown(markdown)) {
    // Display and inline maths in the notes, checked exactly first.
    const maths = [...chunk.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)].map((m, i) => ({ id: `${i}`, latex: (m[1] ?? m[2]).trim() }));
    const exact = opts.helper === false ? [] : (await mathFindings(maths)).map((f) => f.message);
    const chunkRuns = runs.filter((r) => chunk.includes(r.code)).map((r) => r.note);
    const { verdict } = await review(checkNotesPrompt({ ...subject, notes: chunk, exact, runs: chunkRuns }), opts, 4000);
    if (verdict === undefined) {
      checked = false;
      continue;
    }
    const fixed = applyTextFixes(chunk, verdict);
    if (fixed.fixes) {
      content = content.replace(chunk, () => fixed.text);
      fixes += fixed.fixes;
    }
  }
  return { content, fixes, checked };
}

// --- quiz ---------------------------------------------------------------------------

type Section = "mcq" | "numerical" | "short";

/** Replace questions the reviewer re-solved and found wrong, keeping each fix only if it still validates. */
export function quizFixes(quiz: Quiz, verdict: unknown): { quiz: Quiz; fixes: number } {
  const out: Quiz = { mcq: [...quiz.mcq], numerical: [...quiz.numerical], short: [...quiz.short] };
  let fixes = 0;
  for (const f of fixList(verdict)) {
    const section = f.section as Section;
    const i = Number(f.index);
    if (!["mcq", "numerical", "short"].includes(section) || !Number.isInteger(i) || i < 0 || i >= out[section].length) continue;
    const merged = { ...out[section][i], ...(typeof f.question === "object" && f.question !== null ? f.question : {}) };
    const valid = sanitizeQuiz({ [section]: [merged] })?.[section]?.[0];
    if (!valid) continue;
    (out[section] as unknown[])[i] = valid;
    fixes++;
  }
  return { quiz: out, fixes };
}

export async function checkQuiz(subject: CheckSubject, quiz: Quiz, opts: CheckOpts): Promise<{ quiz: Quiz; fixes: number; checked: boolean }> {
  if (!verifyEnabled()) return { quiz, fixes: 0, checked: false };
  const { verdict } = await review(checkQuizPrompt({ ...subject, quiz }), opts, 5000);
  if (verdict === undefined) return { quiz, fixes: 0, checked: false };
  return { ...quizFixes(quiz, verdict), checked: true };
}
