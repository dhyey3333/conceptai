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

describe("labelHtml", () => {
  it("renders bare formula labels as maths but leaves words alone", async () => {
    const { labelHtml } = await import("@/lib/math/render");
    expect(labelHtml("V_in = 9V")).toContain("katex");
    expect(labelHtml("x^2")).toContain("katex");
    expect(labelHtml("snake case label")).not.toContain("katex");
    expect(labelHtml("Battery")).not.toContain("katex");
  });
});
