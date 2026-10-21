"use client";

/**
 * The student's own pen layer, drawn over the teacher's board.
 * Strokes are stored in board coordinates (not screen pixels), so they stay
 * attached to the content at any zoom level. perfect-freehand turns the raw
 * pointer samples into a pressure-aware outline that looks like real ink.
 */
import { useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import type { Stroke } from "@/lib/lesson/types";
import { newId } from "@/lib/lesson/types";

export type InkTool = "select" | "pen" | "highlighter" | "eraser";

const average = (a: number, b: number) => (a + b) / 2;

/** perfect-freehand outline -> SVG path (from the library's README). */
function pathFromOutline(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${b[0].toFixed(1)},${b[1].toFixed(1)} ${average(b[0], c[0]).toFixed(1)},${average(b[1], c[1]).toFixed(1)} T`;
  for (let i = 2; i < len - 1; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${average(a[0], b[0]).toFixed(1)},${average(a[1], b[1]).toFixed(1)} `;
  }
  return d + "Z";
}

export function strokePath(s: Stroke): string {
  const hl = s.tool === "highlighter";
  return pathFromOutline(
    getStroke(s.points, {
      size: s.size,
      thinning: hl ? 0 : 0.55,
      smoothing: 0.55,
      streamline: 0.45,
      simulatePressure: !hl && s.points.every((p) => p[2] === 0.5),
      last: true,
    }),
  );
}

function hits(s: Stroke, x: number, y: number, r: number): boolean {
  const rr = (r + s.size / 2) ** 2;
  return s.points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= rr);
}

export type InkAction = { kind: "add"; strokes: Stroke[] } | { kind: "remove"; strokes: Stroke[] };

export function InkLayer({
  strokes,
  tool,
  color,
  scale,
  onAction,
}: {
  strokes: Stroke[];
  tool: InkTool;
  color: string;
  scale: number;
  onAction: (a: InkAction) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const erased = useRef<Stroke[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const drawing = useRef(false);

  const toBoard = (e: React.PointerEvent): [number, number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale, pressure];
  };

  const eraseAt = (x: number, y: number) => {
    const r = 14 / Math.max(scale, 0.4);
    const victims = strokes.filter((s) => !hidden.has(s.id) && hits(s, x, y, r));
    if (!victims.length) return;
    erased.current.push(...victims);
    setHidden((h) => new Set([...h, ...victims.map((v) => v.id)]));
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === "select" || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = toBoard(e);
    if (tool === "eraser") {
      erased.current = [];
      eraseAt(p[0], p[1]);
      return;
    }
    setDraft({
      id: newId("s"),
      tool,
      color: tool === "highlighter" ? "#ffd166" : color,
      size: tool === "highlighter" ? 24 : 5,
      points: [p],
    });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toBoard(e);
    if (tool === "eraser") return eraseAt(p[0], p[1]);
    // Coalesced events give smooth strokes on fast pen movement.
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
    const r = svgRef.current!.getBoundingClientRect();
    const extra: [number, number, number][] = events.map((ev) => [
      (ev.clientX - r.left) / scale,
      (ev.clientY - r.top) / scale,
      ev.pointerType === "pen" ? ev.pressure || 0.5 : 0.5,
    ]);
    setDraft((d) => (d ? { ...d, points: [...d.points, ...(extra.length ? extra : [p])] } : d));
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (tool === "eraser") {
      if (erased.current.length) onAction({ kind: "remove", strokes: erased.current });
      erased.current = [];
      setHidden(new Set());
      return;
    }
    if (draft && draft.points.length > 1) onAction({ kind: "add", strokes: [draft] });
    else if (draft) onAction({ kind: "add", strokes: [{ ...draft, points: [...draft.points, [draft.points[0][0] + 0.5, draft.points[0][1] + 0.5, 0.5]] }] });
    setDraft(null);
  };

  const active = tool !== "select";
  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      style={{
        pointerEvents: active ? "auto" : "none",
        touchAction: active ? "none" : "auto",
        cursor: tool === "eraser" ? "cell" : active ? "crosshair" : "default",
        zIndex: 5,
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {strokes
        .filter((s) => !hidden.has(s.id))
        .map((s) => (
          <path key={s.id} d={strokePath(s)} fill={s.color} fillOpacity={s.tool === "highlighter" ? 0.3 : 0.95} />
        ))}
      {draft && <path d={strokePath(draft)} fill={draft.color} fillOpacity={draft.tool === "highlighter" ? 0.3 : 0.95} />}
    </svg>
  );
}
