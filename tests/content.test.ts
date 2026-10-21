import { describe, expect, it } from "vitest";
import { beatsFromObject, type SanitizeReport } from "@/lib/board/schema";
import { buildSampleLesson, SAMPLES } from "@/lib/lesson/samples";
import { buildTimeline, pageItems, START_KEY } from "@/lib/lesson/timeline";
import { sanitizeQuiz } from "@/lib/quiz/schema";
import { splitSections } from "@/components/notes/MarkdownView";

describe("sample lessons", () => {
  it("pass the same validator as AI output with nothing dropped", () => {
    for (const s of SAMPLES) {
      for (const [id, beats] of Object.entries(s.sections)) {
        const report: SanitizeReport = { dropped: 0 };
        const out = beats.flatMap((b) => beatsFromObject(b, report));
        expect(report.dropped, `${s.id}/${id}`).toBe(0);
        expect(out).toHaveLength(beats.length);
      }
    }
  });

  it("build a full timeline", () => {
    const l = buildSampleLesson("sample-newton")!;
    const t = buildTimeline(l);
    expect(t.length).toBeGreaterThan(10);
    expect(new Set(t.map((x) => x.key)).size).toBe(t.length);
  });
});

describe("timeline with questions", () => {
  it("splices an answer right after the beat that was interrupted", () => {
    const l = buildSampleLesson("sample-pythagoras")!;
    const anchor = buildTimeline(l)[2].key;
    l.qa.push({
      id: "q1",
      afterKey: anchor,
      sectionId: "s1",
      question: "Why?",
      mode: "question",
      beats: [{ say: "Because.", draw: [{ type: "math", latex: "x" }] }],
      status: "ready",
      createdAt: 0,
    });
    const t = buildTimeline(l);
    expect(t[3].key).toBe("qa:q1:0");
    // the board shows a question card before the answer's items
    const items = pageItems(t, "s1", 3).map((p) => p.item);
    expect(items.at(-2)).toMatchObject({ type: "text", tone: "question", text: "Why?" });
    expect(items.at(-1)).toMatchObject({ type: "math" });
  });

  it("places answers given before the lesson starts first", () => {
    const l = buildSampleLesson("sample-pythagoras")!;
    l.qa.push({ id: "q0", afterKey: START_KEY, sectionId: "s1", question: "Hi?", mode: "question", beats: [{ say: "Hello", draw: [] }], status: "ready", createdAt: 0 });
    expect(buildTimeline(l)[0].key).toBe("qa:q0:0");
  });
});

describe("sanitizeQuiz", () => {
  it("accepts common model variations", () => {
    const q = sanitizeQuiz({
      mcqs: [
        { question: "2+2?", choices: ["3", "4", "5", "6"], correct: "B", explanation: "basic" },
        { q: "Pick", options: ["x", "y"], answer: "y", explanation: "by text" },
        { q: "bad index", options: ["a", "b"], answer: 7, explanation: "dropped" },
      ],
      numerical: [{ q: "I = 20/10?", answer: "2 A", solution: ["I = V/R", "= 2 A"] }],
      short: [{ question: "Define", answer: "A definition" }],
    });
    expect(q?.mcq.map((m) => m.answer)).toEqual([1, 1]);
    expect(q?.numerical[0]).toMatchObject({ answer: 2, unit: "A" });
    expect(q?.short).toHaveLength(1);
  });

  it("returns null when nothing usable came back", () => {
    expect(sanitizeQuiz({ mcq: [{ q: "no options" }] })).toBeNull();
    expect(sanitizeQuiz("nope")).toBeNull();
  });
});

describe("splitSections", () => {
  it("splits at ## headings but not inside code fences or display maths", () => {
    const md = "# T\nintro\n## A\ntext\n```\n## not a heading\n```\n$$\n## x\n$$\n## B\nend";
    const parts = splitSections(md);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toContain("## not a heading");
    expect(parts[2].startsWith("## B")).toBe(true);
  });
});

describe("normaliseMathDelimiters", () => {
  it("turns \\[ \\] and \\( \\) into $$ and $, but leaves code alone", async () => {
    const { normaliseMathDelimiters } = await import("@/components/notes/MarkdownView");
    const md = "Energy \\(E=mc^2\\) and\n\\[ X[k]=\\sum_n x[n] \\]\n`\\(code\\)`\n```\n\\[raw\\]\n```";
    const out = normaliseMathDelimiters(md);
    expect(out).toContain("Energy $E=mc^2$ and");
    expect(out).toContain("$$\nX[k]=\\sum_n x[n]\n$$");
    expect(out).toContain("`\\(code\\)`");
    expect(out).toContain("```\n\\[raw\\]\n```");
  });
});

describe("notesContinuation", () => {
  it("sends only headings and the tail, and asks to continue without repeating", async () => {
    const { notesContinuation } = await import("@/lib/server/prompts");
    const notes = "# T\n## 1. Key Definitions\n" + "x".repeat(20000) + "\n## 10. Important Questions\nThe derivation of X[k] = ";
    const p = notesContinuation(notes);
    expect(p).toContain("## 1. Key Definitions");
    expect(p).toContain("The derivation of X[k] = ");
    expect(p.length).toBeLessThan(5500);
    expect(p).toMatch(/do not repeat/i);
  });
});
