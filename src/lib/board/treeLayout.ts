/**
 * Automatic tree layout, so a model only says what is in a tree, never where.
 *
 * Binary trees (heaps, BSTs) place each node at its in-order position: a BST
 * reads left to right in sorted order and a lone right child sits to the
 * right of its parent, as in textbooks. Other trees put leaves side by side
 * and centre each parent over its children. Depth sets the row.
 */
import type { ItemOf } from "./schema";

type TreeItem = ItemOf<"tree">;

export interface LaidNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Circles for short labels, rounded boxes for words. */
  round: boolean;
  depth: number;
  /** Drawing order: level by level, left to right. */
  order: number;
  highlighted: boolean;
  color?: string;
}

export interface LaidEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  /** The child's drawing order (the edge appears just before it). */
  order: number;
}

export interface TreeLayout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  width: number;
  height: number;
}

const NODE_H = 46;
const LEVEL_GAP = 84;
const GAP = 18;
const PAD = 8;
const CHAR_PX = 12;

/** Display text of a label: "$x_1$" counts as "x1" for sizing. */
const visible = (s: string) => s.replace(/\$|\\[a-zA-Z]+|[{}^_]/g, "");

export function nodeSize(label: string): { w: number; h: number; round: boolean } {
  const chars = visible(label).length;
  if (chars <= 3) return { w: NODE_H, h: NODE_H, round: true };
  return { w: Math.min(190, chars * CHAR_PX + 28), h: NODE_H, round: false };
}

/** Where the segment from a node's centre towards (tx, ty) leaves its outline. */
function exitPoint(n: LaidNode, tx: number, ty: number): [number, number] {
  const dx = tx - n.x;
  const dy = ty - n.y;
  const len = Math.hypot(dx, dy) || 1;
  if (n.round) return [n.x + (dx / len) * (n.w / 2), n.y + (dy / len) * (n.h / 2)];
  const t = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity);
  return [n.x + dx * t, n.y + dy * t];
}

export function layoutTree(item: TreeItem): TreeLayout {
  const kids = new Map<string, TreeItem["nodes"]>();
  const roots: TreeItem["nodes"] = [];
  for (const n of item.nodes) {
    if (n.parent === undefined) roots.push(n);
    else kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  }
  const childrenOf = (id: string) => kids.get(id) ?? [];

  // Column (in slot units) for every node.
  const col = new Map<string, number>();
  let next = 0;
  const binary = item.binary === true;
  const inorder = (id: string) => {
    const c = childrenOf(id);
    const left = c.find((k) => k.side === "left");
    const right = c.find((k) => k.side === "right");
    if (left) inorder(left.id);
    col.set(id, next++);
    if (right) inorder(right.id);
  };
  const tidy = (id: string): number => {
    const c = childrenOf(id);
    if (!c.length) {
      col.set(id, next++);
      return col.get(id)!;
    }
    const xs = c.map((k) => tidy(k.id));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    col.set(id, x);
    return x;
  };
  roots.forEach((r, i) => {
    if (i > 0) next += 0.5; // a little air between the trees of a forest
    if (binary) inorder(r.id);
    else tidy(r.id);
  });

  // Depth and drawing order: breadth first from each root.
  const depth = new Map<string, number>();
  const order: string[] = [];
  const queue = roots.map((r) => r.id);
  roots.forEach((r) => depth.set(r.id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const k of childrenOf(id)) {
      depth.set(k.id, depth.get(id)! + 1);
      queue.push(k.id);
    }
  }

  const sizes = new Map(item.nodes.map((n) => [n.id, nodeSize(n.label)]));
  const slot = Math.max(...[...sizes.values()].map((s) => s.w)) + GAP;
  const maxCol = Math.max(0, ...col.values());
  const maxDepth = Math.max(0, ...depth.values());
  const highlight = new Set(item.highlight ?? []);
  const rank = new Map(order.map((id, i) => [id, i]));

  const nodes: LaidNode[] = item.nodes
    .filter((n) => depth.has(n.id))
    .map((n) => {
      const s = sizes.get(n.id)!;
      return {
        id: n.id,
        label: n.label,
        x: PAD + slot / 2 + col.get(n.id)! * slot,
        y: PAD + NODE_H / 2 + depth.get(n.id)! * LEVEL_GAP,
        ...s,
        depth: depth.get(n.id)!,
        order: rank.get(n.id)!,
        // A highlight may name a node by id or by its label.
        highlighted: highlight.has(n.id) || highlight.has(n.label),
        color: n.color,
      };
    })
    .sort((a, b) => a.order - b.order);

  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidEdge[] = [];
  for (const n of item.nodes) {
    const child = at.get(n.id);
    const parent = n.parent !== undefined ? at.get(n.parent) : undefined;
    if (!child || !parent) continue;
    const [x1, y1] = exitPoint(parent, child.x, child.y);
    const [x2, y2] = exitPoint(child, parent.x, parent.y);
    edges.push({ from: parent.id, to: child.id, x1, y1, x2, y2, label: n.edge, order: child.order });
  }

  return {
    nodes,
    edges,
    width: PAD * 2 + (maxCol + 1) * slot,
    height: PAD * 2 + NODE_H + maxDepth * LEVEL_GAP,
  };
}
