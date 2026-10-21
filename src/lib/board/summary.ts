/** Plain-text descriptions of board items, used as context for follow-up questions. */
import type { BoardItem, ItemOf } from "./schema";

/**
 * Describe a figure so a model can reason about it: labelled shapes with
 * their positions, plus which ones are joined by lines or arrows. A list of
 * labels alone loses the structure (e.g. which node is a heap's last leaf).
 */
export function describeFigure(item: ItemOf<"figure">): string {
  type Node = { label: string; x: number; y: number; link: boolean };
  const nodes: Node[] = [];
  for (const s of item.shapes) {
    const label = s.shape === "text" ? s.text : s.label;
    if (!label) continue;
    let x: number;
    let y: number;
    switch (s.shape) {
      case "circle":
      case "ellipse":
      case "arc":
        [x, y] = [s.cx, s.cy];
        break;
      case "rect":
        [x, y] = [s.x + s.w / 2, s.y + s.h / 2];
        break;
      case "point":
      case "text":
        [x, y] = [s.x, s.y];
        break;
      case "polygon":
      case "curve":
        x = s.points.reduce((a, p) => a + p[0], 0) / s.points.length;
        y = s.points.reduce((a, p) => a + p[1], 0) / s.points.length;
        break;
      case "line":
      case "arrow":
        [x, y] = [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
        break;
    }
    nodes.push({ label, x: Math.round(x), y: Math.round(y), link: s.shape === "line" || s.shape === "arrow" });
  }
  // Which labelled shapes do the lines join? Snap each endpoint to the nearest one.
  const nearest = (px: number, py: number) => {
    let best: Node | undefined;
    let bestD = 18 ** 2;
    for (const n of nodes) {
      if (n.link) continue; // lines join things; they are not endpoints
      const d = (n.x - px) ** 2 + (n.y - py) ** 2;
      if (d < bestD) [best, bestD] = [n, d];
    }
    return best;
  };
  const links: string[] = [];
  for (const s of item.shapes) {
    if (s.shape !== "line" && s.shape !== "arrow") continue;
    const a = nearest(s.x1, s.y1);
    const b = nearest(s.x2, s.y2);
    if (a && b && a !== b) links.push(`${a.label}${s.shape === "arrow" ? "→" : "–"}${b.label}`);
  }
  const parts = [
    `Figure${item.caption ? `: ${item.caption}` : ""}`,
    nodes.length ? `labelled parts at (x, y), y grows downward: ${nodes.slice(0, 16).map((n) => `${n.label} (${n.x}, ${n.y})`).join("; ")}` : "",
    links.length ? `joined: ${links.slice(0, 16).join(", ")}` : "",
  ];
  return parts.filter(Boolean).join(". ");
}

/** A tree as parent → children lines, so a follow-up question can reason about its shape. */
export function describeTree(item: ItemOf<"tree">): string {
  const label = new Map(item.nodes.map((n) => [n.id, n.label]));
  const kids = new Map<string, string[]>();
  for (const n of item.nodes) {
    if (n.parent === undefined) continue;
    const side = item.binary && n.side ? `${n.side} ` : "";
    kids.set(n.parent, [...(kids.get(n.parent) ?? []), `${side}${n.label}${n.edge ? ` [${n.edge}]` : ""}`]);
  }
  const roots = item.nodes.filter((n) => n.parent === undefined).map((n) => n.label);
  const links = [...kids].map(([p, c]) => `${label.get(p)} → ${c.join(", ")}`);
  const lit = item.highlight?.length ? `; highlighted: ${item.highlight.map((h) => label.get(h) ?? h).join(", ")}` : "";
  return `${item.binary ? "Binary tree" : "Tree"}${item.caption ? ` (${item.caption})` : ""}: root ${roots.join(", ")}; ${links.join("; ")}${lit}`;
}

/** An array with its index numbers, pointers and marked cells. */
export function describeArray(item: ItemOf<"array">): string {
  const base = item.start ?? 0;
  const cells = item.values.map((v, i) => `[${i + base}] ${v || "(empty)"}`).join(", ");
  const pointers = item.pointers?.length ? `; pointers: ${item.pointers.map((p) => `${p.label} at ${p.index}`).join(", ")}` : "";
  const lit = item.highlight?.length ? `; highlighted indices: ${item.highlight.join(", ")}` : "";
  const dim = item.dim?.length ? `; greyed out: ${item.dim.join(", ")}` : "";
  return `Array${item.label ? ` ${item.label}` : ""}${item.caption ? ` (${item.caption})` : ""}: ${cells}${pointers}${lit}${dim}`;
}

export function summarizeItem(item: BoardItem): string {
  switch (item.type) {
    case "title":
      return `Title: ${item.text}`;
    case "heading":
      return `Heading: ${item.text}`;
    case "text":
      return `${item.tone && item.tone !== "normal" ? item.tone[0].toUpperCase() + item.tone.slice(1) : "Note"}: ${item.text}`;
    case "bullets":
      return `List: ${item.items.join("; ")}`;
    case "math":
      return `Equation${item.label ? ` (${item.label})` : ""}: ${item.latex}`;
    case "steps":
      return `Steps: ${item.lines.map((l) => l.latex + (l.note ? ` [${l.note}]` : "")).join(" → ")}`;
    case "table":
      return `Table [${item.headers.join(" | ")}]: ${item.rows.map((r) => r.join(" | ")).join("; ")}`;
    case "flowchart": {
      const label = new Map(item.nodes.map((n) => [n.id, n.label]));
      const edges = (item.edges ?? []).map((e) => `${label.get(e.from)} → ${label.get(e.to)}${e.label ? ` (${e.label})` : ""}`);
      return `Flowchart: ${edges.length ? edges.join("; ") : item.nodes.map((n) => n.label).join(", ")}`;
    }
    case "figure":
      return describeFigure(item);
    case "tree":
      return describeTree(item);
    case "array":
      return describeArray(item);
    case "plot":
      return `Graph of ${(item.functions ?? []).map((f) => f.label ?? f.expr).join(", ") || "data points"} for x in [${item.xMin}, ${item.xMax}]`;
  }
}

export function summarizeItems(items: BoardItem[], maxChars = 2500): string {
  let out = "";
  for (const it of items) {
    const line = "- " + summarizeItem(it) + "\n";
    if (out.length + line.length > maxChars) break;
    out += line;
  }
  return out.trim();
}
