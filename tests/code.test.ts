import { describe, expect, it, vi } from "vitest";
import { sanitizeItem, type Beat } from "@/lib/board/schema";
import { tokenizeLine } from "@/lib/board/highlight";
import type { StreamEvent } from "@/lib/server/http";

// The helper (Python) and the reviewer (an AI model) are faked; what is checked is how runs reach the board.
const ran: string[][] = [];
vi.mock("@/lib/server/helper", () => ({
  mathFindings: vi.fn(async () => []),
  callHelper: vi.fn(async () => null),
  runPython: vi.fn(async (cells: string[]) => {
    ran.push(cells);
    return cells.map((c) =>
      c.includes("lenght")
        ? { ok: false, output: "", error: "NameError: name 'lenght' is not defined", line: 2 }
        : { ok: true, output: c.includes("print") ? "[1, 2, 3]\n" : "" },
    );
  }),
}));
const prompts: string[] = [];
vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm")>()),
  completeText: vi.fn(async (opts: { messages: { content: string }[] }) => {
    prompts.push(opts.messages[0].content);
    return JSON.stringify({ fixes: [{ beat: 1, draw: [{ type: "code", code: "def size(xs):\n    return len(xs)\n\nprint(sorted([3, 1, 2]))" }] }] });
  }),
}));

describe("code on the board", () => {
  it("keeps indentation and blank lines, unwraps fences and reads the language", () => {
    const item = sanitizeItem({ type: "python", code: "```python\ndef f(x):\n\treturn x\n\n\nprint(f(1))   \n```" });
    expect(item).toMatchObject({ type: "code", lang: "python", code: "def f(x):\n    return x\n\n\nprint(f(1))" });
    expect(sanitizeItem({ type: "code", lang: "C++", code: "int main() {}" })).toMatchObject({ lang: "cpp" });
    expect(sanitizeItem({ type: "code", lang: "brainfuck", code: "+++" })).toMatchObject({ lang: "pseudocode" });
    expect(sanitizeItem({ type: "snippet", lines: ["x = 1", "print(x)"] })).toMatchObject({ lang: "python", code: "x = 1\nprint(x)" });
    expect(sanitizeItem({ type: "code", code: "   " })).toBeNull();
  });

  it("undoes over-escaped line breaks and quotes, but keeps escapes inside strings", async () => {
    const { repairEscapes } = await import("@/lib/board/code-text");
    // As a model actually sent it: some line breaks real, some written as \n, and \" for quotes.
    const sent = String.raw`from collections import deque\nfrom typing import Optional
\nclass Stack:
    def __init__(self) -> None:
        self._items = deque()  # don't use a list\n
\ns = Stack()\nprint(f\"Top: {len(s._items)}\", 'a\nb', "it's")`;
    expect(repairEscapes(sent)).toBe(
      ["from collections import deque", "from typing import Optional", "", "class Stack:", "    def __init__(self) -> None:", "        self._items = deque()  # don't use a list", "", "", "s = Stack()", String.raw`print(f"Top: {len(s._items)}", 'a\nb', "it's")`].join("\n"),
    );
    const ok = String.raw`print("a\tb\n")  # fine` + "\nx = 1 + \\\n    2";
    expect(repairEscapes(ok)).toBe(ok);
    expect(sanitizeItem({ type: "code", code: String.raw`x = 1\nprint(x)` })).toMatchObject({ code: "x = 1\nprint(x)" });
    expect(sanitizeItem({ type: "code", lang: "java", code: String.raw`int x = 1;\nSystem.out.println(x);` })).toMatchObject({ code: "int x = 1;\nSystem.out.println(x);" });
  });

  it("draws an empty stack as one empty cell", () => {
    expect(sanitizeItem({ type: "array", label: "stack", values: [] })).toMatchObject({ values: [""], indices: false });
  });

  it("colours keywords, strings, numbers, comments and built-ins", () => {
    const kinds = tokenizeLine('def f(n):  # count "up"', "python").map((t) => `${t.kind}:${t.text}`);
    expect(kinds).toEqual(["kw:def", "plain: ", "def:f", "plain:(n):  ", 'com:# count "up"']);
    expect(tokenizeLine("print(len('ab'), 42)", "python").filter((t) => t.kind !== "plain").map((t) => t.kind)).toEqual(["fn", "fn", "str", "num"]);
  });

  it("runs Python as beats arrive, shows only the real result, and runs corrected code again", async () => {
    const { writeThenCheck } = await import("@/lib/server/verify");
    const beats: Beat[] = [
      { say: "A helper.", draw: [{ type: "code", lang: "python", code: "xs = [3, 1, 2]" }] },
      // The model claims an output; it is replaced by what the code really does (it fails).
      { say: "Its size.", draw: [{ type: "code", lang: "python", code: "def size(xs):\n    return lenght(xs)", run: { ok: true, output: "3" } }] },
      { say: "Sorted.", draw: [{ type: "code", lang: "python", code: "print(sorted(xs))" }] },
    ];
    async function* write(): AsyncGenerator<StreamEvent> {
      for (const beat of beats) yield { type: "beat", beat };
      yield { type: "done" };
    }
    const events: StreamEvent[] = [];
    for await (const ev of writeThenCheck(write(), { topic: "Lists", level: "college", context: "Part 1" }, { signal: new AbortController().signal })) events.push(ev);

    const drawn = events.filter((e) => e.type === "beat").map((e) => (e.beat as Beat).draw[0]);
    expect(drawn.map((d) => d.type === "code" && d.run)).toEqual([
      { ok: true, output: "" },
      { ok: false, output: "", error: "NameError: name 'lenght' is not defined", line: 2 },
      { ok: true, output: "[1, 2, 3]\n" },
    ]);
    // Each snippet ran after the ones before it (they share one namespace, like notebook cells).
    expect(ran[2]).toEqual(["xs = [3, 1, 2]", "def size(xs):\n    return lenght(xs)", "print(sorted(xs))"]);
    expect(prompts[0]).toContain("CODE RUNS");
    expect(prompts[0]).toContain("[beat 1] This Python code FAILS when actually run: NameError: name 'lenght' is not defined (line 2)");
    expect(prompts[0]).toContain('[beat 2] This Python code was actually run; it prints "[1, 2, 3]"');
    expect(prompts[0]).not.toContain('"run"');

    // The corrected beat comes back with a fresh run of the corrected code.
    const fixes = events.filter((e) => e.type === "fix");
    expect(fixes.map((f) => f.index)).toEqual([1]);
    expect((fixes[0].beat as Beat).draw[0]).toMatchObject({ type: "code", run: { ok: true } });
  });

  it("never takes a saved run on trust: the code is run again", async () => {
    const { rerunCode } = await import("@/lib/server/verify");
    const saved: Beat[] = [{ say: "x", draw: [{ type: "code", lang: "python", code: "print(sorted([2, 3, 1]))", run: { ok: true, output: "made up" } }] }];
    const [fresh] = await rerunCode(saved);
    expect(fresh.draw[0]).toMatchObject({ run: { ok: true, output: "[1, 2, 3]\n" } });
    expect(saved[0].draw[0]).toMatchObject({ run: { output: "made up" } });
  });

  it("runs the Python blocks in notes and holds the stated output to the real one", async () => {
    const { checkNotes } = await import("@/lib/server/verify");
    prompts.length = 0;
    const notes = "## Sorting\n\n```python\nprint(sorted([3, 1, 2]))\n```\n\nOutput:\n\n```text\n[3, 2, 1]\n```\n";
    await checkNotes({ topic: "Sorting", level: "college", context: "notes" }, notes, { signal: new AbortController().signal });
    expect(prompts[0]).toContain('CODE RUNS');
    expect(prompts[0]).toContain('The python block starting "print(sorted([3, 1, 2]))" prints "[1, 2, 3]".');
  });
});
