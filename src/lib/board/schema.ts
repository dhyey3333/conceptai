/**
 * The whiteboard vocabulary.
 *
 * The AI never sends code. It sends JSON "board items" from this closed list,
 * and every item is validated here before anything is drawn: unknown types and
 * fields are dropped, strings are length-capped and stripped of control
 * characters, numbers are clamped to the drawable area, and lists are capped.
 * A malformed item is discarded on its own instead of failing the whole lesson.
 */
import { z } from "zod";

export const COLORS = ["white", "yellow", "blue", "green", "red", "pink", "orange", "purple", "gray"] as const;
export type BoardColor = (typeof COLORS)[number];

export const TONES = ["normal", "definition", "important", "example", "tip", "question"] as const;
export type Tone = (typeof TONES)[number];

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value: string, max: number): string {
  return value.replace(CONTROL_CHARS, "").replace(/\s+\n/g, "\n").trim().slice(0, max);
}

/** Required text: coerced from numbers, cleaned, truncated (not rejected) when long. */
const text = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => cleanText(String(v), max))
    .pipe(z.string().min(1));

/** Optional text that silently disappears when invalid or empty. */
const optText = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => cleanText(String(v), max) || undefined)
    .optional()
    .catch(undefined);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A finite number clamped into [lo, hi]. Strings like "42" are accepted. */
const num = (lo: number, hi: number) =>
  z.coerce
    .number()
    .refine((n) => Number.isFinite(n))
    .transform((n) => clamp(n, lo, hi));

const optNum = (lo: number, hi: number) => num(lo, hi).optional().catch(undefined);

// Figures use a 0..100 wide coordinate space; allow a little overshoot for labels.
const coord = num(-20, 220);
const point = z.tuple([coord, coord]);

const color = z.enum(COLORS).optional().catch(undefined);
const bool = z.boolean().optional().catch(undefined);
const size = z.enum(["half", "full"]).optional().catch(undefined);
const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/)
  .optional()
  .catch(undefined);

const nonEmpty = (a: unknown[]) => a.length > 0;

/** Validate each list element on its own and keep the ones that pass. */
function lenientArray<T extends z.ZodTypeAny>(schema: T, max: number) {
  return z
    .array(z.unknown())
    .transform((arr) =>
      arr
        .map((v) => schema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => r.data as z.output<T>)
        .slice(0, max),
    );
}

// ---------------------------------------------------------------------------
// Figure shapes
// ---------------------------------------------------------------------------

const shapeBase = { color, label: optText(60) };

export const ShapeSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("line"), x1: coord, y1: coord, x2: coord, y2: coord, dashed: bool, ...shapeBase }),
  z.object({
    shape: z.literal("arrow"),
    x1: coord,
    y1: coord,
    x2: coord,
    y2: coord,
    dashed: bool,
    double: bool,
    ...shapeBase,
  }),
  z.object({ shape: z.literal("rect"), x: coord, y: coord, w: num(0.5, 200), h: num(0.5, 200), fill: bool, ...shapeBase }),
  z.object({ shape: z.literal("circle"), cx: coord, cy: coord, r: num(0.3, 100), fill: bool, ...shapeBase }),
  z.object({
    shape: z.literal("ellipse"),
    cx: coord,
    cy: coord,
    rx: num(0.3, 100),
    ry: num(0.3, 100),
    fill: bool,
    ...shapeBase,
  }),
  z.object({ shape: z.literal("polygon"), points: z.array(point).min(3).max(16), fill: bool, ...shapeBase }),
  z.object({ shape: z.literal("curve"), points: z.array(point).min(2).max(40), dashed: bool, ...shapeBase }),
  z.object({
    shape: z.literal("arc"),
    cx: coord,
    cy: coord,
    r: num(0.3, 100),
    start: num(-720, 720),
    end: num(-720, 720),
    ...shapeBase,
  }),
  z.object({
    shape: z.literal("text"),
    x: coord,
    y: coord,
    text: text(80),
    size: z.enum(["sm", "md", "lg"]).optional().catch(undefined),
    color,
  }),
  z.object({ shape: z.literal("point"), x: coord, y: coord, ...shapeBase }),
]);
export type Shape = z.output<typeof ShapeSchema>;

// ---------------------------------------------------------------------------
// Board items
// ---------------------------------------------------------------------------

const itemBase = { id, color };

const PlotFunctionSchema = z.object({ expr: text(120), label: optText(40), color });
const PlotPointSchema = z.object({ x: num(-1e6, 1e6), y: num(-1e6, 1e6), label: optText(30) });
const FlowNodeSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => cleanText(String(v), 40)).pipe(z.string().min(1)),
  label: text(70),
  shape: z.enum(["box", "round", "diamond", "circle"]).optional().catch(undefined),
});
const FlowEdgeSchema = z.object({
  from: z.union([z.string(), z.number()]).transform((v) => String(v)),
  to: z.union([z.string(), z.number()]).transform((v) => String(v)),
  label: optText(30),
});

export const BoardItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("title"), text: text(90), ...itemBase }),
  z.object({ type: z.literal("heading"), text: text(90), ...itemBase }),
  z.object({
    type: z.literal("text"),
    text: text(320),
    tone: z.enum(TONES).optional().catch(undefined),
    size,
    ...itemBase,
  }),
  z.object({
    type: z.literal("bullets"),
    items: lenientArray(text(160), 8).refine(nonEmpty),
    ordered: bool,
    size,
    ...itemBase,
  }),
  z.object({ type: z.literal("math"), latex: text(400), label: optText(60), boxed: bool, size, ...itemBase }),
  z.object({
    type: z.literal("steps"),
    lines: lenientArray(z.object({ latex: text(300), note: optText(80) }), 10).refine(nonEmpty),
    size,
    ...itemBase,
  }),
  z.object({
    type: z.literal("table"),
    headers: lenientArray(text(50), 6).refine(nonEmpty),
    rows: lenientArray(lenientArray(z.union([z.string(), z.number()]).transform((v) => cleanText(String(v), 80)), 6), 10),
    size,
    ...itemBase,
  }),
  z.object({
    type: z.literal("flowchart"),
    direction: z.enum(["TB", "LR"]).optional().catch(undefined),
    nodes: lenientArray(FlowNodeSchema, 14).refine(nonEmpty),
    edges: lenientArray(FlowEdgeSchema, 24).optional().catch(undefined),
    size,
    ...itemBase,
  }),
  z.object({
    type: z.literal("figure"),
    height: optNum(15, 120),
    caption: optText(80),
    shapes: lenientArray(ShapeSchema, 40).refine(nonEmpty),
    size,
    ...itemBase,
  }),
  z.object({
    type: z.literal("plot"),
    functions: lenientArray(PlotFunctionSchema, 4).optional().catch(undefined),
    points: lenientArray(PlotPointSchema, 20).optional().catch(undefined),
    xMin: num(-1e6, 1e6).catch(-5),
    xMax: num(-1e6, 1e6).catch(5),
    yMin: optNum(-1e6, 1e6),
    yMax: optNum(-1e6, 1e6),
    xLabel: optText(30),
    yLabel: optText(30),
    size,
    ...itemBase,
  }),
]);

export type BoardItem = z.output<typeof BoardItemSchema>;
export type BoardItemType = BoardItem["type"];
export type ItemOf<T extends BoardItemType> = Extract<BoardItem, { type: T }>;

/** A beat is one breath of teaching: a few spoken sentences and what gets drawn meanwhile. */
export interface Beat {
  say: string;
  draw: BoardItem[];
  /** id of an earlier board item to point at while speaking */
  point?: string;
}

// ---------------------------------------------------------------------------
// Normalisation of real-world LLM output
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Record<string, BoardItemType> = {
  title: "title",
  heading: "heading",
  header: "heading",
  subheading: "heading",
  section: "heading",
  text: "text",
  note: "text",
  definition: "text",
  callout: "text",
  paragraph: "text",
  label: "text",
  bullets: "bullets",
  bullet: "bullets",
  list: "bullets",
  points: "bullets",
  math: "math",
  equation: "math",
  formula: "math",
  latex: "math",
  steps: "steps",
  derivation: "steps",
  solution: "steps",
  table: "table",
  flowchart: "flowchart",
  flow: "flowchart",
  process: "flowchart",
  figure: "figure",
  diagram: "figure",
  drawing: "figure",
  sketch: "figure",
  plot: "plot",
  graph: "plot",
  chart: "plot",
};

const SHAPE_ALIASES: Record<string, Shape["shape"]> = {
  line: "line",
  segment: "line",
  arrow: "arrow",
  vector: "arrow",
  rect: "rect",
  rectangle: "rect",
  box: "rect",
  square: "rect",
  circle: "circle",
  ellipse: "ellipse",
  oval: "ellipse",
  polygon: "polygon",
  triangle: "polygon",
  curve: "curve",
  path: "curve",
  polyline: "curve",
  arc: "arc",
  angle: "arc",
  text: "text",
  label: "text",
  point: "point",
  dot: "point",
};

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

function normaliseShape(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const s: Loose = { ...raw };
  const kind = String(s.shape ?? s.type ?? s.kind ?? "").toLowerCase();
  s.shape = SHAPE_ALIASES[kind] ?? kind;
  if (s.shape === "text" && s.text === undefined) s.text = s.label ?? s.value ?? s.content;
  // Accept {x, y} objects for points as well as [x, y] pairs.
  if (Array.isArray(s.points)) {
    s.points = s.points.map((p) => (isObj(p) ? [p.x, p.y] : p));
  }
  if (s.shape === "point" && Array.isArray(s.at)) [s.x, s.y] = s.at as unknown[];
  return s;
}

function normaliseItem(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const it: Loose = { ...raw };
  const kind = String(it.type ?? it.kind ?? "").toLowerCase();
  it.type = TYPE_ALIASES[kind] ?? kind;
  if (kind === "definition" && !it.tone) it.tone = "definition";
  if ((it.type === "text" || it.type === "title" || it.type === "heading") && it.text === undefined) {
    it.text = it.content ?? it.value ?? it.label;
  }
  if (it.type === "math" && it.latex === undefined) it.latex = it.equation ?? it.formula ?? it.tex ?? it.text;
  if (it.type === "math" && typeof it.latex === "string") it.latex = stripMathDelimiters(it.latex);
  if (it.type === "bullets" && it.items === undefined) it.items = it.points ?? it.list ?? it.lines;
  if (it.type === "steps") {
    const lines = it.lines ?? it.steps;
    if (Array.isArray(lines)) {
      it.lines = lines.map((l) =>
        typeof l === "string"
          ? { latex: stripMathDelimiters(l) }
          : isObj(l)
            ? { ...l, latex: stripMathDelimiters(String(l.latex ?? l.math ?? l.equation ?? l.text ?? "")) }
            : l,
      );
    }
  }
  if (it.type === "figure") {
    const shapes = it.shapes ?? it.elements ?? it.items;
    if (Array.isArray(shapes)) it.shapes = shapes.map(normaliseShape);
  }
  if (it.type === "plot") {
    if (it.functions === undefined && (it.expr || it.fn || it.function)) {
      it.functions = [{ expr: it.expr ?? it.fn ?? it.function, label: it.label }];
    }
    if (Array.isArray(it.functions)) {
      it.functions = it.functions.map((f) => (typeof f === "string" ? { expr: f } : f));
    }
    const range = (key: string) => (Array.isArray(it[key]) ? (it[key] as unknown[]) : undefined);
    const xr = range("xRange") ?? range("xrange");
    const yr = range("yRange") ?? range("yrange");
    if (xr) [it.xMin, it.xMax] = xr;
    if (yr) [it.yMin, it.yMax] = yr;
  }
  return it;
}

/** "$x^2$" or "\[x^2\]" from the model become "x^2" for display math. */
export function stripMathDelimiters(latex: string): string {
  return latex
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, "$1")
    .replace(/^\$([\s\S]*)\$$/, "$1")
    .replace(/^\\\[([\s\S]*)\\\]$/, "$1")
    .replace(/^\\\(([\s\S]*)\\\)$/, "$1")
    .trim();
}

export interface SanitizeReport {
  dropped: number;
}

/** Validate one item from the model. Returns null when it cannot be drawn safely. */
export function sanitizeItem(raw: unknown, report?: SanitizeReport): BoardItem | null {
  const parsed = BoardItemSchema.safeParse(normaliseItem(raw));
  if (!parsed.success) {
    if (report) report.dropped++;
    return null;
  }
  const item = parsed.data;
  // Small models like to prefix headings with "Section 2:"; the board shows parts already.
  if (item.type === "heading") item.text = item.text.replace(/^(section|part|step)\s*\d+\s*[:.\-–—]\s*/i, "") || item.text;
  // Plots need a usable x range.
  if (item.type === "plot") {
    if (!(item.xMax > item.xMin)) [item.xMin, item.xMax] = [-5, 5];
    if (item.yMin !== undefined && item.yMax !== undefined && !(item.yMax > item.yMin)) {
      item.yMin = item.yMax = undefined;
    }
    if (!item.functions?.length && !item.points?.length) {
      if (report) report.dropped++;
      return null;
    }
  }
  // Flowchart edges must connect existing nodes.
  if (item.type === "flowchart" && item.edges) {
    const ids = new Set(item.nodes.map((n) => n.id));
    item.edges = item.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  }
  return item;
}

const MAX_ITEMS_PER_BEAT = 6;

/** Validate one beat. Accepts a few shapes models commonly produce. */
export function sanitizeBeat(raw: unknown, report?: SanitizeReport): Beat | null {
  if (!isObj(raw)) return null;
  // A model sometimes emits a bare board item where a beat was expected.
  if (raw.type && !raw.say && !raw.draw) {
    const item = sanitizeItem(raw, report);
    return item ? { say: "", draw: [item] } : null;
  }
  const sayRaw = raw.say ?? raw.narration ?? raw.speech ?? raw.speak ?? raw.voice ?? "";
  const say = cleanText(typeof sayRaw === "string" ? sayRaw : String(sayRaw), 900);
  let drawRaw = raw.draw ?? raw.board ?? raw.items ?? raw.actions ?? raw.write ?? [];
  if (isObj(drawRaw)) drawRaw = [drawRaw];
  const draw: BoardItem[] = [];
  if (Array.isArray(drawRaw)) {
    for (const r of drawRaw) {
      const item = sanitizeItem(r, report);
      if (item) draw.push(item);
      if (draw.length >= MAX_ITEMS_PER_BEAT) break;
    }
  }
  const pointRaw = raw.point ?? raw.highlight;
  const point = typeof pointRaw === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(pointRaw) ? pointRaw : undefined;
  if (!say && draw.length === 0) return null;
  return { say, draw, point };
}

/** Pull beats out of whatever JSON object the model produced ({beats:[...]}, a beat, or an item). */
export function beatsFromObject(obj: unknown, report?: SanitizeReport): Beat[] {
  if (Array.isArray(obj)) return obj.flatMap((o) => beatsFromObject(o, report));
  if (!isObj(obj)) return [];
  const list = obj.beats ?? obj.lesson ?? obj.answer;
  if (Array.isArray(list) && !obj.say && !obj.type) return list.flatMap((o) => beatsFromObject(o, report));
  const beat = sanitizeBeat(obj, report);
  return beat ? [beat] : [];
}
