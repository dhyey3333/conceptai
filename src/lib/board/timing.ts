/**
 * Voice/board synchronisation maths.
 *
 * A beat's drawing is stretched to fit the time the teacher spends speaking it,
 * so the pen finishes a formula roughly as the sentence about it ends. Each item
 * gets a share of the beat proportional to how much there is to draw.
 */
import type { BoardItem } from "./schema";

export interface ItemTiming {
  start: number; // ms from beat start
  dur: number; // ms
}

const MIN_ITEM_MS = 550;
const MAX_ITEM_MS = 9000;

/** Rough effort to draw an item, in "units"; only ratios matter. */
export function itemWeight(item: BoardItem): number {
  switch (item.type) {
    case "title":
      return 1.3;
    case "heading":
      return 1;
    case "text":
      return 0.6 + item.text.length / 55;
    case "bullets":
      return item.items.reduce((s, t) => s + 0.5 + t.length / 60, 0);
    case "math":
      return 1 + item.latex.length / 35;
    case "steps":
      return item.lines.reduce((s, l) => s + 0.9 + l.latex.length / 40, 0);
    case "table":
      return 0.6 + 0.18 * item.headers.length * (item.rows.length + 1);
    case "flowchart":
      return 0.5 + 0.55 * item.nodes.length + 0.25 * (item.edges?.length ?? 0);
    case "figure":
      return 0.6 + 0.35 * item.shapes.length;
    case "plot":
      return 1.6 + 0.9 * (item.functions?.length ?? 0) + 0.1 * (item.points?.length ?? 0);
  }
}

/** Speaking time estimate (~165 words/min at 1x), used when the real duration is unknown. */
export function estimateSpeechMs(text: string, rate = 1): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (!words) return 0;
  const sentences = (text.match(/[.!?।]+/g) ?? []).length;
  return ((words / 2.75) * 1000 + sentences * 220) / rate;
}

/** Lay items out back-to-back so they fill `totalMs` (at least the minimum per item). */
export function allocateTimings(items: BoardItem[], totalMs: number): ItemTiming[] {
  if (!items.length) return [];
  const weights = items.map(itemWeight);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return weights.map((w) => {
    const dur = Math.min(MAX_ITEM_MS, Math.max(MIN_ITEM_MS, (totalMs * w) / sum));
    const t = { start: cursor, dur };
    cursor += dur;
    return t;
  });
}

/** How long the drawing for a beat should take, given how long the speech lasts. */
export function drawBudgetMs(items: BoardItem[], speechMs: number, rate = 1): number {
  if (!items.length) return 0;
  // With no speech (muted or silent beat) draw at a calm natural pace.
  const natural = items.reduce((s, it) => s + itemWeight(it) * 900, 0) / rate;
  if (speechMs <= 0) return natural;
  // Finish a little before the sentence does, but never rush complex drawings.
  return Math.max(speechMs * 0.85, Math.min(natural, speechMs * 1.6), items.length * MIN_ITEM_MS);
}
