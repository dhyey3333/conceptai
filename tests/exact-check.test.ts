import { describe, expect, it, vi } from "vitest";
import type { Beat } from "@/lib/board/schema";

// What the reviewer was asked, and the Python helper's exact findings (both faked: no model, no Python).
const prompts: string[] = [];
vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm")>()),
  completeText: vi.fn(async (opts: { messages: { content: string }[] }) => {
    prompts.push(opts.messages[0].content);
    return JSON.stringify({ fixes: [{ beat: 1, say: "The middle index is (0 + 6) / 2 = 3." }] });
  }),
}));
const asked: unknown[] = [];
vi.mock("@/lib/server/helper", () => ({
  mathFindings: vi.fn(async (items: unknown[]) => {
    asked.push(...items);
    return [{ id: "1.0", latex: "mid = \\frac{0+6}{2} = 2", message: "mid = \\frac{0+6}{2} = 2 is wrong: the left side is 3, not 2" }];
  }),
}));

const beats: Beat[] = [
  { say: "Search for 23.", draw: [{ type: "text", text: "Array has $n = 7$ items" }] },
  { say: "The middle index is (0 + 6) / 2 = 2.", draw: [{ type: "math", latex: "mid = \\frac{0+6}{2} = 2" }] },
  { say: "Steps.", draw: [{ type: "steps", lines: [{ latex: "(x+2)^2" }, { latex: "= x^2+4x+4" }] }] },
];

describe("finding the input of a part's worked example", () => {
  it("takes the first list of three or more numbers, from an array item or written text", async () => {
    const { exampleInput } = await import("@/lib/server/verify");
    expect(exampleInput([{ say: "Sort it.", draw: [{ type: "array", values: ["3", "1", "2"] }] }])).toEqual([3, 1, 2]);
    expect(exampleInput([{ say: "Take [5, 1, 4, 2] and sort it.", draw: [] }])).toEqual([5, 1, 4, 2]);
    expect(exampleInput([{ say: "x", draw: [{ type: "steps", lines: [{ latex: "[9, 4, 7] \\to [4, 9, 7]" }] }] }])).toEqual([9, 4, 7]);
    expect(exampleInput([{ say: "Two numbers [1, 2] only.", draw: [] }])).toBeUndefined();
  });
});

describe("exact maths checks in the fact-check", () => {
  it("sends every equation to SymPy and tells the reviewer what it found as certain", async () => {
    const { checkBeats } = await import("@/lib/server/verify");
    const r = await checkBeats({ topic: "Binary search", level: "college", context: "Part 2", reference: "WORKED EXAMPLE ... mid=(0+6)//2=3" }, beats, {
      signal: new AbortController().signal,
    });
    expect(asked).toEqual([
      { id: "0.0.0.0", latex: "n = 7" },
      { id: "1.0", latex: "mid = \\frac{0+6}{2} = 2" },
      { id: "2.0", lines: ["(x+2)^2", "= x^2+4x+4"] },
    ]);
    expect(prompts[0]).toContain("EXACT CHECKS (computed with SymPy) found these definite errors");
    expect(prompts[0]).toContain("[beat 1] mid = \\frac{0+6}{2} = 2 is wrong: the left side is 3, not 2");
    expect(prompts[0]).toContain("REFERENCE, computed by actually running the algorithm");
    expect(r.fixes.map((f) => f.index)).toEqual([1]);
  });

  it("can be switched off (to measure what it adds)", async () => {
    const { checkBeats } = await import("@/lib/server/verify");
    asked.length = 0;
    prompts.length = 0;
    await checkBeats({ topic: "t", level: "college", context: "c" }, beats, { signal: new AbortController().signal, helper: false });
    expect(asked).toEqual([]);
    expect(prompts[0]).not.toContain("EXACT CHECKS");
  });
});
