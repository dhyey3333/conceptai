/**
 * The whiteboard vocabulary.
 *
 * The AI never sends anything the browser runs. It sends JSON "board items" from this closed list,
 * and every item is validated here before anything is drawn: unknown types and
 * fields are dropped, strings are length-capped and stripped of control
 * characters, numbers are clamped to the drawable area, and lists are capped.
 * A malformed item is discarded on its own instead of failing the whole lesson.
 */
import { z } from "zod";
import { repairEscapes } from "./code-text";

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

/** A node reference: any short string or number. */
const ref = z.union([z.string(), z.number()]).transform((v) => cleanText(String(v), 40)).pipe(z.string().min(1));
const index = z.coerce.number().int().min(0).max(99);

const TreeNodeSchema = z.object({
  id: ref,
  label: text(24),
  parent: ref.optional().catch(undefined),
  /** In a binary tree, which child this is (so a lone right child is drawn on the right). */
  side: z.enum(["left", "right"]).optional().catch(undefined),
  /** Label on the edge from the parent (e.g. "yes", "0"). */
  edge: optText(20),
  color,
});

const ArrayPointerSchema = z.object({ index, label: text(14), color });
/** An array cell; null or "" is an empty cell. */
const cell = z.union([z.string(), z.number(), z.null()]).transform((v) => (v === null ? "" : cleanText(String(v), 12)));

export const CODE_LANGS = ["python", "pseudocode", "c", "cpp", "java", "javascript", "sql"] as const;
const CODE_MAX_LINES = 30;

/** Program text keeps its indentation and blank lines (cleanText would fold them); tabs become 4 spaces. */
export function cleanCode(value: string): string {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/\t/g, "    ")
    .split("\n")
    .map((l) => l.trimEnd().slice(0, 110));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(0, CODE_MAX_LINES).join("\n");
}

/** What happened when the code was run (set by the server only, never taken from the model). */
const CodeRunSchema = z.object({
  ok: z.boolean(),
  output: z.string().max(2000).catch(""),
  error: z.string().max(300).optional().catch(undefined),
  line: z.number().int().optional().catch(undefined),
});
export type CodeRun = z.output<typeof CodeRunSchema>;

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
  // Trees and arrays are laid out by the board itself, so the model only says
  // what is in them, never where: no overlapping nodes or edges that miss.
  z.object({
    type: z.literal("tree"),
    nodes: lenientArray(TreeNodeSchema, 31).refine(nonEmpty),
    binary: bool,
    highlight: lenientArray(ref, 31).optional().catch(undefined),
    caption: optText(80),
    size,
    ...itemBase,
  }),
  z.object({
    type: z.literal("array"),
    values: lenientArray(cell, 24).refine(nonEmpty),
    /** Name written before the array, e.g. "A". */
    label: optText(12),
    /** First index (0 or 1); pointers, highlight and dim use the same numbering. */
    start: z.coerce.number().int().min(0).max(1).optional().catch(undefined),
    indices: bool,
    pointers: lenientArray(ArrayPointerSchema, 6).optional().catch(undefined),
    highlight: lenientArray(index, 24).optional().catch(undefined),
    dim: lenientArray(index, 24).optional().catch(undefined),
    caption: optText(80),
    size,
    ...itemBase,
  }),
  // Program text, shown with syntax colours and written line by line. It is only ever
  // displayed on the board; Python is run by the local helper (python/helper/coderun.py).
  z.object({
    type: z.literal("code"),
    code: z.string().transform(cleanCode).pipe(z.string().min(1)),
    lang: z.enum(CODE_LANGS).catch("python"),
    /** Lines to mark (1-based), e.g. the line being explained. */
    highlight: lenientArray(z.coerce.number().int().min(1).max(CODE_MAX_LINES), 10).optional().catch(undefined),
    caption: optText(80),
    run: CodeRunSchema.optional().catch(undefined),
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
  tree: "tree",
  heap: "tree",
  bst: "tree",
  binary_tree: "tree",
  recursion_tree: "tree",
  decision_tree: "tree",
  trie: "tree",
  hierarchy: "tree",
  array: "array",
  arr: "array",
  array_diagram: "array",
  memory: "array",
  cells: "array",
  code: "code",
  snippet: "code",
  program: "code",
  python: "code",
  pseudocode: "code",
  algorithm: "code",
};

const LANG_ALIASES: Record<string, (typeof CODE_LANGS)[number]> = {
  python: "python",
  python3: "python",
  py: "python",
  pseudocode: "pseudocode",
  pseudo: "pseudocode",
  algorithm: "pseudocode",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  sql: "sql",
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

const nodeLabel = (n: Loose) => n.label ?? n.value ?? n.name ?? n.key ?? n.val ?? n.text;
const isEmptyCell = (v: unknown) => v === null || v === undefined || v === "" || v === "null" || v === "None";

/** A binary tree in level order (heap / array layout): node i's parent is (i - 1) / 2. Empty slots are skipped. */
function levelOrderNodes(values: unknown[]): Loose[] {
  const present = new Set<number>();
  const out: Loose[] = [];
  values.slice(0, 31).forEach((v, i) => {
    const parent = (i - 1) >> 1;
    if (isEmptyCell(v) || (i > 0 && !present.has(parent))) return;
    present.add(i);
    out.push({ id: String(i), label: v, parent: i > 0 ? String(parent) : undefined, side: i === 0 ? undefined : i % 2 ? "left" : "right" });
  });
  return out;
}

/** A nested tree ({label, children:[...]}, or {label, left, right}) as a flat node list. */
function flattenTree(root: Loose): Loose[] {
  const out: Loose[] = [];
  const walk = (n: unknown, parent: string | undefined, side: string | undefined, depth: number) => {
    if (!isObj(n) || out.length >= 31 || depth > 8) return;
    const id = `n${out.length}`;
    out.push({ id, label: nodeLabel(n), parent, side, edge: n.edge, color: n.color });
    if (Array.isArray(n.children)) n.children.forEach((c) => walk(c, id, undefined, depth + 1));
    if (n.left !== undefined || n.right !== undefined) {
      walk(n.left, id, "left", depth + 1);
      walk(n.right, id, "right", depth + 1);
    }
  };
  walk(root, undefined, undefined, 0);
  return out;
}

/** Nodes listed with "children" (ids or nested objects) instead of "parent". */
function normaliseTreeNodes(nodes: unknown[]): unknown[] {
  if (nodes.some((n) => isObj(n) && Array.isArray(n.children) && n.children.some(isObj))) {
    const root = nodes.find(isObj);
    return root ? flattenTree(root) : nodes;
  }
  const out = nodes.map((n) => (isObj(n) ? { ...n, label: nodeLabel(n), id: n.id ?? nodeLabel(n) } : n)) as Loose[];
  for (const n of out) {
    if (!isObj(n) || !Array.isArray(n.children)) continue;
    for (const c of n.children) {
      const child = out.find((m) => isObj(m) && String(m.id) === String(c));
      if (child && child.parent === undefined) child.parent = n.id;
    }
  }
  return out;
}

function normaliseItem(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const it: Loose = { ...raw };
  const kind = String(it.type ?? it.kind ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
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
  if (it.type === "tree") {
    const values = it.values ?? it.levelOrder ?? it.level_order ?? it.array ?? it.heap ?? it.data;
    if (it.nodes === undefined && Array.isArray(values)) {
      it.nodes = levelOrderNodes(values);
      it.binary ??= true;
    } else if (it.nodes === undefined && isObj(it.root)) it.nodes = flattenTree(it.root);
    else if (Array.isArray(it.nodes)) it.nodes = normaliseTreeNodes(it.nodes);
    if (it.highlight !== undefined && !Array.isArray(it.highlight)) it.highlight = [it.highlight];
  }
  if (it.type === "code") {
    let code = it.code ?? it.source ?? it.program ?? it.text ?? it.content ?? it.lines;
    if (Array.isArray(code)) code = code.map(String).join("\n");
    // Code wrapped in a Markdown fence: keep what is inside (and its language).
    const fence = typeof code === "string" ? /^\s*```([\w+#-]*)[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(code) : null;
    if (fence) {
      code = fence[2];
      it.lang ??= fence[1] || undefined;
    }
    // Missing language: Python (what lessons run). Named but unknown: shown, never run.
    const lang = String(it.lang ?? it.language ?? (kind === "pseudocode" || kind === "algorithm" ? "pseudocode" : "python")).toLowerCase();
    it.lang = LANG_ALIASES[lang] ?? "pseudocode";
    // Python and pseudocode get the full repair; other languages have different comments, so only
    // code with no real line break at all (every one over-escaped) is split at its "\n"s.
    if (typeof code === "string") {
      if (it.lang === "python" || it.lang === "pseudocode") code = repairEscapes(code);
      else if (!code.includes("\n")) code = code.replace(/\\n/g, "\n");
    }
    it.code = code;
    if (it.highlight !== undefined && !Array.isArray(it.highlight)) it.highlight = [it.highlight];
  }
  if (it.type === "array") {
    it.values ??= it.items ?? it.elements ?? it.data ?? it.cells ?? it.array;
    if (typeof it.values === "string") it.values = it.values.split(/\s*,\s*|\s+/).filter(Boolean);
    // An empty stack or list is worth drawing: one empty cell, without an index.
    if (Array.isArray(it.values) && it.values.length === 0) {
      it.values = [""];
      it.indices = false;
    }
    // Pointers as {"low": 0, "high": 6}, or with "at"/"i"/"name" keys.
    if (isObj(it.pointers)) it.pointers = Object.entries(it.pointers).map(([label, at]) => ({ label, index: at }));
    if (Array.isArray(it.pointers)) {
      it.pointers = it.pointers.map((p) => (isObj(p) ? { ...p, index: p.index ?? p.at ?? p.i ?? p.position, label: p.label ?? p.name } : p));
    }
    for (const key of ["highlight", "dim"]) if (it[key] !== undefined && !Array.isArray(it[key])) it[key] = [it[key]];
  }
  return it;
}

/** Make a tree drawable: unique ids, parents that exist, no cycles, and consistent left/right sides. */
function repairTree(item: ItemOf<"tree">): void {
  const seen = new Set<string>();
  item.nodes = item.nodes.filter((n) => !seen.has(n.id) && seen.add(n.id));
  const byId = new Map(item.nodes.map((n) => [n.id, n]));
  for (const n of item.nodes) {
    if (n.parent !== undefined && (!byId.has(n.parent) || n.parent === n.id)) n.parent = undefined;
  }
  // A parent chain that loops back is cut where it closes.
  for (const n of item.nodes) {
    const path = new Set<string>([n.id]);
    let cur = n;
    while (cur.parent !== undefined) {
      if (path.has(cur.parent)) {
        cur.parent = undefined;
        break;
      }
      path.add(cur.parent);
      cur = byId.get(cur.parent)!;
    }
  }
  const kids = new Map<string, typeof item.nodes>();
  for (const n of item.nodes) if (n.parent !== undefined) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const binary = item.binary || item.nodes.some((n) => n.side);
  item.binary = binary && [...kids.values()].every((c) => c.length <= 2);
  if (!item.binary) {
    item.nodes.forEach((n) => (n.side = undefined));
    return;
  }
  for (const c of kids.values()) {
    // Two children on the same side, or unmarked: first is left, second right.
    if (c.length === 2 && c[0].side === c[1].side) [c[0].side, c[1].side] = ["left", "right"];
    else if (c.length === 2) {
      c[0].side ??= c[1].side === "left" ? "right" : "left";
      c[1].side ??= c[0].side === "left" ? "right" : "left";
    } else c[0].side ??= "left";
  }
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
  /** Why items were dropped ("figure: shapes", "flowchart"), to find gaps in the vocabulary. */
  reasons?: string[];
}

/** Validate one item from the model. Returns null when it cannot be drawn safely. */
export function sanitizeItem(raw: unknown, report?: SanitizeReport): BoardItem | null {
  const normalised = normaliseItem(raw);
  const parsed = BoardItemSchema.safeParse(normalised);
  if (!parsed.success) {
    if (report) {
      report.dropped++;
      const type = isObj(normalised) ? String(normalised.type ?? "?") : typeof raw;
      const field = parsed.error.issues[0]?.path.join(".") ?? "";
      report.reasons?.push(field ? `${type}: ${field}` : type);
    }
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
  if (item.type === "tree") repairTree(item);
  // Array markers must point at real cells.
  if (item.type === "array") {
    const base = item.start ?? 0;
    const inRange = (i: number) => i - base >= 0 && i - base < item.values.length;
    item.pointers = item.pointers?.filter((p) => inRange(p.index));
    item.highlight = item.highlight?.filter(inRange);
    item.dim = item.dim?.filter(inRange);
  }
  return item;
}

const MAX_ITEMS_PER_BEAT = 6;

/** A run of LaTeX written without $...$: a command (\omega) or a braced power/index (e^{jt}, x_{n}). */
const BARE_LATEX = /[A-Za-z0-9().]*(?:\\[a-zA-Z]+|[\^_]\{[^}$]*\})(?:[A-Za-z0-9().^_]|\\[a-zA-Z]+|\{[^}$]*\})*/g;

/**
 * Narration should be plain spoken words, but models sometimes write
 * "e^{j\omega t}" in it. Wrap such fragments in $...$ so the chat renders them
 * as maths and the voice reads them as words instead of "backslash omega".
 */
export function wrapBareLatex(text: string): string {
  if (!/\\[a-zA-Z]|[\^_]\{/.test(text)) return text;
  return text
    .split(/(\$[^$]*\$)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(BARE_LATEX, (m) => `$${m}$`)))
    .join("");
}

/** Validate one beat. Accepts a few shapes models commonly produce. */
export function sanitizeBeat(raw: unknown, report?: SanitizeReport): Beat | null {
  if (!isObj(raw)) return null;
  // A model sometimes emits a bare board item where a beat was expected.
  if (raw.type && !raw.say && !raw.draw) {
    const item = sanitizeItem(raw, report);
    return item ? { say: "", draw: [item] } : null;
  }
  const sayRaw = raw.say ?? raw.narration ?? raw.speech ?? raw.speak ?? raw.voice ?? "";
  const say = wrapBareLatex(cleanText(typeof sayRaw === "string" ? sayRaw : String(sayRaw), 900));
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
