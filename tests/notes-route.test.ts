import { describe, expect, it, vi } from "vitest";

// The model and the fact-check are faked; what is checked is how a long document is split into requests.
let budget = 40000;
vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm")>()),
  requireLlm: vi.fn(),
  sourceBudget: vi.fn(() => budget),
  streamText: vi.fn(async function* (opts: { onFallback?: (n: unknown) => void }) {
    // Gemini's daily allowance runs out during the first block: the chain moves to a model that reads less.
    opts.onFallback?.({ from: "gemini", to: "groq", reason: "quota", local: false, minutes: 900 + Math.round(budget / 1000) });
    budget = 9000;
    // Each model picks its own heading levels.
    yield "# My own heading\n\nNotes.";
  }),
}));
vi.mock("@/lib/server/verify", () => ({ verifyEnabled: () => false, checkNotes: vi.fn() }));
const scopes: unknown[] = [];
vi.mock("@/lib/server/prompts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/prompts")>();
  return {
    ...real,
    notesPrompt: vi.fn((args: Parameters<typeof real.notesPrompt>[0]) => {
      scopes.push(args.scope);
      return real.notesPrompt(args);
    }),
  };
});

const page = (n: number) => `[page ${n}]\n${`Page ${n} explains one more idea about image transformations in plain words. `.repeat(30)}`;
const source = Array.from({ length: 30 }, (_, i) => page(i + 1)).join("\n");

describe("notes for a whole document", () => {
  it("re-plans the pages still to come in smaller blocks once a smaller model is answering", async () => {
    const { POST } = await import("@/app/api/notes/route");
    const res = await POST(
      new Request("http://localhost/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "Image transformations", level: "college", marks: [5], sourceText: source }),
      }),
    );
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events.at(-1).type).toBe("done");
    // The same switch is reported once, not once per block.
    expect(events.filter((e) => e.type === "notice")).toHaveLength(1);
    // The route writes each part's heading and nests the model's own headings under it.
    const notes: string = events.filter((e) => e.type === "replace").at(-1).text;
    expect(notes.startsWith("# Image transformations\n\n## Part 1: ")).toBe(true);
    expect(notes).toContain("\n## Part 2: ");
    expect(notes).toContain("### My own heading");
    expect(notes).not.toMatch(/^# My own heading/m);
    const pages = scopes.map((s) => (s as { pages?: string }).pages ?? "closing");
    // The first block was planned for Gemini; every page after it is still covered, in blocks a third the size.
    const [one, end] = pages[0].split("-").map(Number);
    expect(one).toBe(1);
    expect(end).toBeGreaterThan(10);
    expect(pages.at(-1)).toBe("closing");
    const rest = pages.slice(1, -1).map((p) => p.split("-").map(Number));
    expect(rest.length).toBeGreaterThanOrEqual(4);
    expect(rest[0][0]).toBe(end + 1);
    expect(rest.at(-1)!.at(-1)).toBe(30);
    for (const [a, b] of rest) expect((b ?? a) - a).toBeLessThan(5);
  });
});
