/**
 * Layered layout for AI flowcharts (a small Sugiyama-style layout).
 *
 * 1. Break cycles by ignoring edges that point back to a node on the DFS stack.
 * 2. Rank nodes by longest path from the sources, so arrows always flow one way.
 * 3. Order nodes inside each rank by the average position of their parents
 *    (barycenter), which removes most edge crossings in teaching-sized charts.
 * 4. Place ranks along the main axis and centre each rank on the cross axis.
 */
import type { ItemOf } from "./schema";

export interface LaidOutNode {
  id: string;
  label: string;
  shape: "box" | "round" | "diamond" | "circle";
  x: number; // centre
  y: number; // centre
  w: number;
  h: number;
  order: number; // drawing order (by rank)
}

export interface LaidOutEdge {
  from: string;
  to: string;
  label?: string;
  path: string; // SVG path
  back: boolean;
  head: [number, number, number]; // arrow tip x, y and angle (radians)
  mid: [number, number];
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const CHAR_W = 10.5; // approx. width of one character at the 19px board font
const LINE_H = 24;
const MAX_LINE_CHARS = 18;

/** Greedy word wrap used both to size nodes and to render their labels. */
export function wrapLabel(label: string, maxChars = MAX_LINE_CHARS): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function nodeSize(label: string, shape: LaidOutNode["shape"]): [number, number] {
  const lines = wrapLabel(label);
  const longest = Math.max(...lines.map((l) => l.length), 4);
  let w = Math.max(110, Math.min(260, longest * CHAR_W + 36));
  let h = Math.max(54, lines.length * LINE_H + 26);
  if (shape === "diamond") {
    w *= 1.35;
    h *= 1.45;
  }
  if (shape === "circle") {
    const d = Math.max(w, h);
    w = h = d;
  }
  return [w, h];
}

export function layoutFlowchart(item: ItemOf<"flowchart">): FlowLayout {
  const dir = item.direction ?? "TB";
  const nodes = item.nodes;
  const ids = nodes.map((n) => n.id);
  const edges = (item.edges ?? []).filter((e) => ids.includes(e.from) && ids.includes(e.to));

  // 1. Detect back edges with an iterative-safe recursive DFS (charts are tiny).
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  edges.forEach((e) => out.get(e.from)!.push(e.to));
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const s = state.get(v) ?? 0;
      if (s === 1) back.add(`${u}->${v}`);
      else if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  ids.forEach((id) => {
    if (!state.get(id)) visit(id);
  });
  const forward = edges.filter((e) => !back.has(`${e.from}->${e.to}`));

  // 2. Longest-path ranking over the acyclic edges.
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const e of forward) {
      const r = rank.get(e.from)! + 1;
      if (r > rank.get(e.to)!) {
        rank.set(e.to, r);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 3. Order within ranks by parent barycenter.
  const maxRank = Math.max(...rank.values());
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  ids.forEach((id) => layers[rank.get(id)!].push(id));
  const posInLayer = new Map<string, number>();
  layers.forEach((layer) => layer.forEach((id, i) => posInLayer.set(id, i)));
  for (let r = 1; r <= maxRank; r++) {
    const bary = (id: string) => {
      const parents = forward.filter((e) => e.to === id).map((e) => posInLayer.get(e.from)!);
      return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : posInLayer.get(id)!;
    };
    layers[r].sort((a, b) => bary(a) - bary(b));
    layers[r].forEach((id, i) => posInLayer.set(id, i));
  }

  // 4. Coordinates. "main" is the flow axis, "cross" the perpendicular one.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sizes = new Map(ids.map((id) => [id, nodeSize(byId.get(id)!.label, byId.get(id)!.shape ?? "box")]));
  const mainGap = dir === "TB" ? 64 : 86;
  const crossGap = dir === "TB" ? 40 : 34;
  const mainSize = (id: string) => (dir === "TB" ? sizes.get(id)![1] : sizes.get(id)![0]);
  const crossSize = (id: string) => (dir === "TB" ? sizes.get(id)![0] : sizes.get(id)![1]);

  const layerMain = layers.map((layer) => Math.max(...layer.map(mainSize)));
  const layerCross = layers.map((layer) => layer.reduce((s, id) => s + crossSize(id), 0) + crossGap * (layer.length - 1));
  const totalCross = Math.max(...layerCross);
  const pad = 16;

  const laid: LaidOutNode[] = [];
  let mainCursor = pad;
  layers.forEach((layer, r) => {
    let crossCursor = pad + (totalCross - layerCross[r]) / 2;
    const mainCentre = mainCursor + layerMain[r] / 2;
    layer.forEach((id) => {
      const [w, h] = sizes.get(id)!;
      const crossCentre = crossCursor + crossSize(id) / 2;
      const n = byId.get(id)!;
      laid.push({
        id,
        label: n.label,
        shape: n.shape ?? "box",
        x: dir === "TB" ? crossCentre : mainCentre,
        y: dir === "TB" ? mainCentre : crossCentre,
        w,
        h,
        order: r,
      });
      crossCursor += crossSize(id) + crossGap;
    });
    mainCursor += layerMain[r] + mainGap;
  });
  const mainTotal = mainCursor - mainGap + pad;
  const width = dir === "TB" ? totalCross + pad * 2 : mainTotal;
  const height = dir === "TB" ? mainTotal : totalCross + pad * 2;

  // Edges: smooth cubic curves from the source's exit side to the target's entry side.
  const node = new Map(laid.map((n) => [n.id, n]));
  const laidEdges: LaidOutEdge[] = edges.map((e) => {
    const a = node.get(e.from)!;
    const b = node.get(e.to)!;
    const isBack = back.has(`${e.from}->${e.to}`);
    let path: string;
    let head: [number, number, number];
    let mid: [number, number];
    if (isBack) {
      // Loop around the outside so it doesn't cut through the chart.
      if (dir === "TB") {
        const sx = a.x + a.w / 2;
        const tx = b.x + b.w / 2;
        const bulge = Math.max(sx, tx) + 60;
        path = `M ${sx} ${a.y} C ${bulge} ${a.y}, ${bulge} ${b.y}, ${tx} ${b.y}`;
        head = [tx, b.y, Math.PI];
        mid = [bulge - 15, (a.y + b.y) / 2];
      } else {
        const sy = a.y + a.h / 2;
        const ty = b.y + b.h / 2;
        const bulge = Math.max(sy, ty) + 50;
        path = `M ${a.x} ${sy} C ${a.x} ${bulge}, ${b.x} ${bulge}, ${b.x} ${ty}`;
        head = [b.x, ty, -Math.PI / 2];
        mid = [(a.x + b.x) / 2, bulge - 12];
      }
    } else if (dir === "TB") {
      const sy = a.y + a.h / 2;
      const ty = b.y - b.h / 2;
      const c = (ty - sy) / 2;
      path = `M ${a.x} ${sy} C ${a.x} ${sy + c}, ${b.x} ${ty - c}, ${b.x} ${ty}`;
      head = [b.x, ty, Math.PI / 2];
      mid = [(a.x + b.x) / 2, (sy + ty) / 2];
    } else {
      const sx = a.x + a.w / 2;
      const tx = b.x - b.w / 2;
      const c = (tx - sx) / 2;
      path = `M ${sx} ${a.y} C ${sx + c} ${a.y}, ${tx - c} ${b.y}, ${tx} ${b.y}`;
      head = [tx, b.y, 0];
      mid = [(sx + tx) / 2, (a.y + b.y) / 2];
    }
    return { from: e.from, to: e.to, label: e.label, path, back: isBack, head, mid };
  });

  const extra = laidEdges.some((e) => e.back) ? 70 : 0;
  return {
    width: width + (dir === "TB" ? extra : 0),
    height: height + (dir === "LR" ? extra : 0),
    nodes: laid,
    edges: laidEdges,
  };
}
