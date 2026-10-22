import { describe, expect, it, vi } from "vitest";
import type { Beat } from "@/lib/board/schema";
import type { Quiz } from "@/lib/quiz/schema";

// The reviewer's reply for the next check; the real model is never called in tests.
let verdict = "{}";
// Simulates a small token budget: a check of more beats than this runs out of room.
let maxBeatsPerCheck = Infinity;
const calls: number[] = [];
vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm")>()),
  completeText: vi.fn(async (opts: { messages: { content: string }[]; onStop?: (r: "length" | "end") => void }) => {
    const shown = opts.messages[0].content.match(/^\[\d+\] \{/gm)?.length ?? 0;
    calls.push(shown);
    if (shown > maxBeatsPerCheck) {
      opts.onStop?.("length");
      return "";
    }
    return verdict;
  }),
}));

const { applyTextFixes, beatFixes, chunkMarkdown, quizFixes, writeThenCheck } = await import("@/lib/server/verify");
const { durationMs, rateLimitWaitMs } = await import("@/lib/server/llm");

const beats: Beat[] = [
  { say: "Build the max-heap.", draw: [{ type: "heading", text: "Heap sort" }] },
  { say: "After the first swap, 4 is in the last position.", draw: [{ type: "text", text: "Last: 4" }] },
];

describe("beat corrections", () => {
  it("validates corrected beats and keeps the drawing when the fix only changes the words", () => {
    const fixes = beatFixes(beats, { fixes: [{ beat: 1, say: "After the first swap, 8 is in the last position." }, { beat: 7, say: "x" }] });
    expect(fixes).toEqual([{ index: 1, beat: { say: "After the first swap, 8 is in the last position.", draw: beats[1].draw, point: undefined } }]);
  });

  it("never lets a correction wipe a drawing or smuggle in unknown items", () => {
    const [fix] = beatFixes(beats, { fixes: [{ beat: 1, say: "Fixed.", draw: [{ type: "script", code: "x" }] }] });
    expect(fix.beat.draw).toEqual(beats[1].draw);
    expect(beatFixes(beats, { ok: true })).toEqual([]);
    expect(beatFixes(beats, { fixes: [{ beat: 0, say: beats[0].say }] })).toEqual([]);
  });

  it("streams beats first, then the check, then fixes and the verdict", async () => {
    verdict = JSON.stringify({ fixes: [{ beat: 1, say: "After the first swap, 8 is in the last position." }] });
    async function* write() {
      for (const beat of beats) yield { type: "beat", beat };
      yield { type: "done", beats: 2, dropped: 0 };
    }
    const events = [];
    for await (const ev of writeThenCheck(write(), { topic: "Heap sort", level: "college", context: "Part 1" }, { signal: new AbortController().signal }))
      events.push(ev.type === "done" ? ev : ev.type);
    expect(events).toEqual(["beat", "beat", "checking", "fix", { type: "done", beats: 2, dropped: 0, checked: true, fixes: 1 }]);
  });

  it("checks a part in halves when the whole part doesn't fit the reviewer's budget", async () => {
    const { checkBeats } = await import("@/lib/server/verify");
    verdict = JSON.stringify({ ok: true });
    maxBeatsPerCheck = 2;
    calls.length = 0;
    const four = [...beats, ...beats];
    const r = await checkBeats({ topic: "t", level: "college", context: "c" }, four, { signal: new AbortController().signal });
    maxBeatsPerCheck = Infinity;
    expect(calls).toEqual([4, 2, 2]);
    expect(r).toEqual({ fixes: [], checked: true });
  });

  it("marks the part unchecked when the reviewer's reply can't be read", async () => {
    verdict = "sorry, no JSON here";
    async function* write() {
      yield { type: "beat", beat: beats[0] };
      yield { type: "done", beats: 1, dropped: 0 };
    }
    const events = [];
    for await (const ev of writeThenCheck(write(), { topic: "t", level: "school", context: "c" }, { signal: new AbortController().signal })) events.push(ev);
    expect(events.at(-1)).toMatchObject({ type: "done", checked: false, fixes: 0 });
  });
});

describe("notes corrections", () => {
  it("applies exact, unique replacements and ignores the rest", () => {
    const md = "Speed of light: $3 \\times 10^5$ m/s.\nIt is constant.\nIt is constant.";
    const out = applyTextFixes(md, {
      fixes: [
        { find: "$3 \\times 10^5$ m/s", replace: "$3 \\times 10^8$ m/s" },
        { find: "It is constant.", replace: "ambiguous" },
        { find: "not in the notes", replace: "x" },
      ],
    });
    expect(out).toEqual({ text: "Speed of light: $3 \\times 10^8$ m/s.\nIt is constant.\nIt is constant.", fixes: 1 });
  });

  it("splits long notes at headings without losing text", () => {
    const md = ["# Title", ...Array.from({ length: 6 }, (_, i) => `## Part ${i}\n${"word ".repeat(400)}`)].join("\n");
    const chunks = chunkMarkdown(md, 4500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4500)).toBe(true);
    expect(chunks.join("\n")).toBe(md);
  });
});

describe("quiz corrections", () => {
  const quiz: Quiz = {
    mcq: [{ q: "Largest in a max-heap?", options: ["Root", "A leaf"], answer: 1, explanation: "Leaves are largest." }],
    numerical: [{ q: "2+2?", answer: 5, solution: ["2+2=5"] }],
    short: [],
  };

  it("replaces only fields the reviewer corrected, and only if the result is valid", () => {
    const out = quizFixes(quiz, {
      fixes: [
        { section: "mcq", index: 0, question: { answer: 0, explanation: "The root holds the maximum." } },
        { section: "numerical", index: 0, question: { answer: 4, solution: ["2+2=4"] } },
        { section: "mcq", index: 0, question: { answer: 9 } },
        { section: "short", index: 0, question: { answer: "x" } },
      ],
    });
    expect(out.fixes).toBe(2);
    expect(out.quiz.mcq[0]).toMatchObject({ answer: 0, explanation: "The root holds the maximum." });
    expect(out.quiz.numerical[0]).toMatchObject({ answer: 4, solution: ["2+2=4"] });
  });
});

describe("rate-limit waits", () => {
  it("reads Retry-After, Groq's reset header, or the wait in the message", () => {
    expect(durationMs("7.66s")).toBeCloseTo(7660);
    expect(durationMs("1m2.5s")).toBeCloseTo(62500);
    expect(durationMs("450ms")).toBe(450);
    expect(durationMs("soon")).toBeNull();
    expect(rateLimitWaitMs(new Headers({ "retry-after": "3" }), "")).toBe(3000);
    expect(rateLimitWaitMs(new Headers({ "x-ratelimit-reset-tokens": "12.15s" }), "")).toBeCloseTo(12150);
    expect(rateLimitWaitMs(new Headers(), "Rate limit reached ... Please try again in 4.2s. Need more tokens?")).toBeCloseTo(4200);
    expect(rateLimitWaitMs(new Headers(), "nothing useful")).toBeNull();
    // Google's wording for a used-up daily free quota.
    expect(rateLimitWaitMs(new Headers(), "Quota exceeded ... limit: 20, model: gemini-3.6-flash\nPlease retry in 17h2m43.383370881s.")).toBeCloseTo(61_363_383, -3);
  });
});
