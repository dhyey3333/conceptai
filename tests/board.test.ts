import { describe, expect, it } from "vitest";
import { beatsFromObject, sanitizeBeat, sanitizeItem, type SanitizeReport } from "@/lib/board/schema";
import { compileExpr, sample } from "@/lib/board/expr";
import { layoutFlowchart } from "@/lib/board/flowLayout";
import { allocateTimings, drawBudgetMs, estimateSpeechMs } from "@/lib/board/timing";
import { richHtml, speakable, splitRich } from "@/lib/math/render";

describe("sanitizeItem", () => {
  it("accepts valid items and strips unknown fields", () => {
    const item = sanitizeItem({ type: "math", latex: "E=mc^2", boxed: true, onclick: "alert(1)" });
    expect(item).toEqual({ type: "math", latex: "E=mc^2", boxed: true });
  });

  it("rejects unknown item types (no arbitrary actions)", () => {
    const report: SanitizeReport = { dropped: 0 };
    expect(sanitizeItem({ type: "script", code: "fetch('/x')" }, report)).toBeNull();
    expect(sanitizeItem({ type: "html", html: "<img onerror=x>" }, report)).toBeNull();
    expect(report.dropped).toBe(2);
  });

  it("maps common aliases from models", () => {
    expect(sanitizeItem({ type: "equation", equation: "$a^2+b^2=c^2$" })).toMatchObject({ type: "math", latex: "a^2+b^2=c^2" });
    expect(sanitizeItem({ type: "list", points: ["a", "b"] })).toMatchObject({ type: "bullets", items: ["a", "b"] });
    expect(sanitizeItem({ type: "graph", expr: "x^2", xRange: [-2, 2] })).toMatchObject({
      type: "plot",
      functions: [{ expr: "x^2" }],
      xMin: -2,
      xMax: 2,
    });
  });

  it("clamps coordinates, caps lists and drops bad shapes individually", () => {
    const item = sanitizeItem({
      type: "figure",
      shapes: [
        { shape: "line", x1: -9999, y1: 10, x2: 50, y2: "20" },
        { shape: "teleport", x: 1 },
        { shape: "triangle", points: [{ x: 0, y: 0 }, [10, 0], [5, 8]] },
      ],
    });
    expect(item?.type).toBe("figure");
    if (item?.type !== "figure") return;
    expect(item.shapes).toHaveLength(2);
    expect(item.shapes[0]).toMatchObject({ shape: "line", x1: -20, y2: 20 });
    expect(item.shapes[1]).toMatchObject({ shape: "polygon", points: [[0, 0], [10, 0], [5, 8]] });
  });

  it("removes flowchart edges to missing nodes", () => {
    const item = sanitizeItem({
      type: "flowchart",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "ghost" }],
    });
    expect(item?.type === "flowchart" && item.edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("truncates very long text instead of failing", () => {
    const item = sanitizeItem({ type: "text", text: "x".repeat(5000) });
    expect(item?.type === "text" && item.text.length).toBe(320);
  });
});

describe("beats", () => {
  it("accepts beats with aliases and a single item for draw", () => {
    expect(sanitizeBeat({ narration: "Hi", board: { type: "heading", text: "Intro" } })).toEqual({
      say: "Hi",
      draw: [{ type: "heading", text: "Intro" }],
      point: undefined,
    });
  });

  it("drops empty beats and unwraps {beats:[...]}", () => {
    const beats = beatsFromObject({ beats: [{ say: "" }, { say: "Hello", draw: [] }] });
    expect(beats).toHaveLength(1);
  });

  it("wraps bare LaTeX in narration so it renders and is spoken as words", async () => {
    const { wrapBareLatex } = await import("@/lib/board/schema");
    const say = "Think of e^{j\\omega t} as a rotating vector, and \\omega as its speed.";
    const wrapped = wrapBareLatex(say);
    expect(wrapped).toBe("Think of $e^{j\\omega t}$ as a rotating vector, and $\\omega$ as its speed.");
    expect(speakable(wrapped)).toBe("Think of e to the power j omega t as a rotating vector, and omega as its speed.");
    expect(wrapBareLatex("Plain words stay $x^2$ as they are.")).toBe("Plain words stay $x^2$ as they are.");
    expect(sanitizeBeat({ say: "So e^{-j\\omega t} spins the other way." })?.say).toBe("So $e^{-j\\omega t}$ spins the other way.");
  });

  it("ignores non-id point values", () => {
    expect(sanitizeBeat({ say: "x", point: "<script>" })?.point).toBeUndefined();
  });
});

describe("compileExpr", () => {
  const f = (e: string, x: number) => compileExpr(e)(x);
  it("evaluates arithmetic, powers and functions", () => {
    expect(f("2x^2 + 3x - 1", 2)).toBe(13);
    expect(f("y = sin(pi/2) * x", 3)).toBeCloseTo(3);
    expect(f("-x^2", 3)).toBe(-9);
    expect(f("2^3^2", 0)).toBe(512);
    expect(f("sqrt(x)(x+1)", 4)).toBe(10);
    expect(f("e^x", 0)).toBe(1);
    expect(f("sin^2(x) + cos^2(x)", 1.234)).toBeCloseTo(1);
    expect(f("9.8*x - 0.5*9.8*x**2", 1)).toBeCloseTo(4.9);
  });

  it("refuses anything outside the whitelist", () => {
    expect(() => compileExpr("alert(1)")).toThrow();
    expect(() => compileExpr("constructor")).toThrow();
    expect(() => compileExpr("x; process.exit()")).toThrow();
    expect(() => compileExpr("[1,2]")).toThrow();
  });

  it("marks undefined points as gaps", () => {
    const pts = sample(compileExpr("1/x"), -1, 1, 2);
    expect(pts[1]).toEqual({ x: 0, y: null });
  });
});

describe("timing", () => {
  it("stretches drawing to the speech and keeps items in order", () => {
    const items = [
      { type: "heading" as const, text: "Ohm's law" },
      { type: "math" as const, latex: "V = IR" },
    ];
    const speech = estimateSpeechMs("Voltage equals current times resistance. This is Ohm's law.");
    const budget = drawBudgetMs(items, speech);
    const t = allocateTimings(items, budget);
    expect(t[0].start).toBe(0);
    expect(t[1].start).toBe(t[0].dur);
    expect(t[0].dur + t[1].dur).toBeGreaterThanOrEqual(speech * 0.8);
  });
});

describe("figure descriptions for follow-up questions", () => {
  it("keeps the structure of a drawn heap, not just its labels", async () => {
    const { describeFigure } = await import("@/lib/board/summary");
    const node = (label: string, cx: number, cy: number) => ({ shape: "circle", cx, cy, r: 6, label });
    const edge = (x1: number, y1: number, x2: number, y2: number) => ({ shape: "line", x1, y1, x2, y2 });
    const item = sanitizeItem({
      type: "figure",
      caption: "max-heap",
      height: 80,
      shapes: [
        node("8", 50, 12), node("5", 25, 40), node("4", 75, 40), node("2", 12, 70), node("1", 38, 70),
        edge(50, 18, 25, 34), edge(50, 18, 75, 34), edge(25, 46, 12, 64), edge(25, 46, 38, 64),
      ],
    });
    if (item?.type !== "figure") throw new Error("bad figure");
    expect(describeFigure(item)).toBe(
      "Figure: max-heap. labelled parts at (x, y), y grows downward: 8 (50, 12); 5 (25, 40); 4 (75, 40); 2 (12, 70); 1 (38, 70). joined: 8–5, 8–4, 5–2, 5–1",
    );
  });
});

describe("flowchart layout", () => {
  it("ranks nodes and tolerates cycles", () => {
    const item = sanitizeItem({
      type: "flowchart",
      nodes: [{ id: "a", label: "Evaporation" }, { id: "b", label: "Condensation" }, { id: "c", label: "Precipitation" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
    });
    if (item?.type !== "flowchart") throw new Error("bad item");
    const l = layoutFlowchart(item);
    const y = Object.fromEntries(l.nodes.map((n) => [n.id, n.y]));
    expect(y.a).toBeLessThan(y.b);
    expect(y.b).toBeLessThan(y.c);
    expect(l.edges.filter((e) => e.back)).toHaveLength(1);
  });

  it("routes a loop-back around every node it passes, with its label outside", () => {
    const item = sanitizeItem({
      type: "flowchart",
      nodes: [
        { id: "c", label: "low ≤ high?", shape: "diamond" },
        { id: "m", label: "mid" },
        { id: "n", label: "return -1 because the search space is empty" },
        { id: "f", label: "found?", shape: "diamond" },
      ],
      edges: [{ from: "c", to: "m" }, { from: "c", to: "n" }, { from: "m", to: "f" }, { from: "f", to: "c", label: "no" }],
    });
    if (item?.type !== "flowchart") throw new Error("bad item");
    const l = layoutFlowchart(item);
    const loop = l.edges.find((e) => e.back)!;
    const wide = l.nodes.find((n) => n.id === "n")!;
    expect(loop.anchor).toBe("start");
    expect(loop.mid[0]).toBeGreaterThan(wide.x + wide.w / 2);
    expect(l.width).toBeGreaterThan(loop.mid[0]);
  });
});

describe("rich text", () => {
  it("splits math, bold and text and escapes HTML", () => {
    expect(splitRich("Force $F=ma$ is **key**").map((s) => s.kind)).toEqual(["text", "math", "text", "bold"]);
    expect(richHtml("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });

  it("refuses KaTeX commands that could inject links or HTML", () => {
    const html = richHtml("$\\href{javascript:alert(1)}{x}$");
    expect(html).not.toContain("javascript:");
  });

  it("makes narration speakable", () => {
    expect(speakable("So $a^2 + b^2 = c^2$ **always**")).toBe("So a squared + b squared equals c squared always");
  });
});

describe("trees", () => {
  const tree = (raw: object) => {
    const item = sanitizeItem({ type: "tree", ...raw });
    if (item?.type !== "tree") throw new Error("not a tree");
    return item;
  };

  it("reads a heap in level order, skipping empty slots and their subtrees", () => {
    const t = tree({ values: [9, 5, 8, null, 2, 7, 6, 1] });
    expect(t.binary).toBe(true);
    expect(t.nodes.map((n) => [n.label, n.parent, n.side])).toEqual([
      ["9", undefined, undefined],
      ["5", "0", "left"],
      ["8", "0", "right"],
      ["2", "1", "right"],
      ["7", "2", "left"],
      ["6", "2", "right"],
    ]);
  });

  it("accepts nested trees and children lists, and the aliases models use", () => {
    const nested = sanitizeItem({ type: "binary tree", root: { value: 8, left: { value: 3 }, right: { value: 10, right: { value: 14 } } } });
    expect(nested?.type === "tree" && nested.nodes.map((n) => `${n.label}:${n.side ?? "-"}`)).toEqual(["8:-", "3:left", "10:right", "14:right"]);
    const listed = tree({ nodes: [{ id: "a", label: "Animals", children: ["b", "c"] }, { id: "b", label: "Mammals" }, { id: "c", label: "Birds" }] });
    expect(listed.nodes.map((n) => n.parent)).toEqual([undefined, "a", "a"]);
    expect(sanitizeItem({ type: "heap", values: [1, 2, 3] })?.type).toBe("tree");
  });

  it("repairs duplicate ids, missing parents and cycles instead of failing", () => {
    const t = tree({
      nodes: [
        { id: "a", label: "A", parent: "c" },
        { id: "b", label: "B", parent: "a" },
        { id: "c", label: "C", parent: "b" },
        { id: "b", label: "dup" },
        { id: "d", label: "D", parent: "ghost" },
      ],
    });
    expect(t.nodes).toHaveLength(4);
    expect(t.nodes.find((n) => n.id === "d")?.parent).toBeUndefined();
    expect(t.nodes.filter((n) => n.parent === undefined).length).toBeGreaterThanOrEqual(2);
  });

  it("lays out without overlaps, parents above children, lone right child on the right", async () => {
    const { layoutTree } = await import("@/lib/board/treeLayout");
    const heap = layoutTree(tree({ values: [9, 5, 8, 4, 2, 7, 6] }));
    const at = new Map(heap.nodes.map((n) => [n.label, n]));
    expect(at.get("9")!.x).toBeCloseTo((at.get("5")!.x + at.get("8")!.x) / 2);
    for (const n of heap.nodes) {
      for (const m of heap.nodes) if (n !== m && n.depth === m.depth) expect(Math.abs(n.x - m.x)).toBeGreaterThanOrEqual((n.w + m.w) / 2);
    }
    expect(heap.edges).toHaveLength(6);
    expect(heap.nodes.map((n) => n.label)).toEqual(["9", "5", "8", "4", "2", "7", "6"]);
    const bst = layoutTree(tree({ nodes: [{ id: "r", label: "5" }, { id: "x", label: "7", parent: "r", side: "right" }] }));
    expect(bst.nodes[1].x).toBeGreaterThan(bst.nodes[0].x);
    expect(bst.nodes[1].y).toBeGreaterThan(bst.nodes[0].y);
  });

  it("describes structure for follow-up questions", async () => {
    const { describeTree } = await import("@/lib/board/summary");
    expect(describeTree(tree({ values: [9, 5, 8], caption: "max-heap" }))).toBe("Binary tree (max-heap): root 9; 9 → left 5, right 8");
  });
});

describe("arrays", () => {
  it("normalises pointer maps and value strings, and drops markers outside the array", () => {
    const item = sanitizeItem({ type: "array", values: "3, 7, 12, 18", pointers: { low: 0, high: 3, oops: 9 }, highlight: 2, dim: [1, 40] });
    if (item?.type !== "array") throw new Error("not an array");
    expect(item.values).toEqual(["3", "7", "12", "18"]);
    expect(item.pointers).toEqual([{ index: 0, label: "low" }, { index: 3, label: "high" }]);
    expect(item.highlight).toEqual([2]);
    expect(item.dim).toEqual([1]);
  });

  it("uses the stated index base for markers", async () => {
    const item = sanitizeItem({ type: "array", values: [4, 8], start: 1, pointers: [{ index: 2, label: "j" }, { index: 0, label: "x" }] });
    if (item?.type !== "array") throw new Error("not an array");
    expect(item.pointers).toEqual([{ index: 2, label: "j" }]);
    const { describeArray } = await import("@/lib/board/summary");
    expect(describeArray(item)).toBe("Array: [1] 4, [2] 8; pointers: j at 2");
  });
});

describe("over-escaped LaTeX", () => {
  it("repairs doubled backslashes before real commands only", async () => {
    const { fixOverEscaped, renderLatex } = await import("@/lib/math/render");
    expect(fixOverEscaped("\\\\log_2 1000 \\\\approx 10")).toBe("\\log_2 1000 \\approx 10");
    expect(fixOverEscaped("a \\\\ b")).toBe("a \\\\ b");
    expect(fixOverEscaped("x=1\\\\\\frac{1}{2}")).toBe("x=1\\\\\\frac{1}{2}");
    expect(fixOverEscaped("a\\\\notacommandxyz")).toBe("a\\\\notacommandxyz");
    expect(renderLatex("\\\\frac{1}{2}")).toBe(renderLatex("\\frac{1}{2}"));
    expect(speakable("$\\\\frac{a}{b}$")).toBe("a over b");
  });
});

describe("labelHtml", () => {
  it("renders bare formula labels as maths but leaves words alone", async () => {
    const { labelHtml } = await import("@/lib/math/render");
    expect(labelHtml("V_in = 9V")).toContain("katex");
    expect(labelHtml("x^2")).toContain("katex");
    expect(labelHtml("snake case label")).not.toContain("katex");
    expect(labelHtml("Battery")).not.toContain("katex");
  });
});
