"use client";

import { useMemo, type ReactNode } from "react";
import type { ItemOf, Shape } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { labelHtml } from "@/lib/math/render";
import { ink, ms, vars } from "./text-items";

const STROKE_PX = 3;
const LABEL_PX: Record<"sm" | "md" | "lg", number> = { sm: 17, md: 21, lg: 28 };

/** Catmull-Rom spline through the points, as cubic Béziers (a hand-drawn-looking curve). */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) return `M ${pts.map((p) => p.join(" ")).join(" L ")}`;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function arrowHead(x: number, y: number, angle: number, size: number): string {
  const a1 = angle + Math.PI - 0.42;
  const a2 = angle + Math.PI + 0.42;
  return `${x},${y} ${x + size * Math.cos(a1)},${y + size * Math.sin(a1)} ${x + size * Math.cos(a2)},${y + size * Math.sin(a2)}`;
}

/** Point on an arc. Angles are in degrees, counter-clockwise from +x as in maths (screen y points down). */
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.cos((deg * Math.PI) / 180),
  cy - r * Math.sin((deg * Math.PI) / 180),
];

interface Label {
  x: number;
  y: number;
  html: string;
  color: string;
  size: number;
  anchor: "start" | "middle" | "end";
  d0: number;
}

/** Extent of the drawn geometry, so a figure the model drew partly off-canvas still fits. */
function shapeBounds(shapes: Shape[]): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const s of shapes) {
    switch (s.shape) {
      case "line":
      case "arrow":
        add(s.x1, s.y1);
        add(s.x2, s.y2);
        break;
      case "rect":
        add(s.x, s.y);
        add(s.x + s.w, s.y + s.h);
        break;
      case "circle":
      case "arc":
        add(s.cx - s.r, s.cy - s.r);
        add(s.cx + s.r, s.cy + s.r);
        break;
      case "ellipse":
        add(s.cx - s.rx, s.cy - s.ry);
        add(s.cx + s.rx, s.cy + s.ry);
        break;
      case "polygon":
      case "curve":
        s.points.forEach(([x, y]) => add(x, y));
        break;
      case "point":
      case "text":
        add(s.x, s.y);
        break;
    }
  }
  return [x0, y0, x1, y1];
}

export function FigureItem({ item, timing, width }: { item: ItemOf<"figure">; timing: ItemTiming | null; width: number }) {
  const H0 = item.height ?? 60;
  // The nominal canvas is 100 x height; grow it (never shrink) to whatever was actually drawn.
  const [bx0, by0, bx1, by1] = useMemo(() => shapeBounds(item.shapes), [item.shapes]);
  const vx = Math.min(0, bx0 - 5);
  const vy = Math.min(0, by0 - 5);
  const vw = Math.max(100, bx1 + 5) - vx;
  const H = Math.max(H0, by1 + 5) - vy;
  const unitPx = width / vw; // px per figure unit
  const sw = STROKE_PX / unitPx;
  const n = item.shapes.length;
  const slot = timing ? timing.dur / n : 0;

  const { nodes, labels } = useMemo(() => {
    const nodes: ReactNode[] = [];
    const labels: Label[] = [];
    item.shapes.forEach((s: Shape, i: number) => {
      const color = ink(s.color ?? item.color);
      const d0 = timing ? timing.start + i * slot : 0;
      const dd = Math.max(250, slot * 1.05);
      const drawStyle = vars({ "--d0": ms(d0), "--dd": ms(dd) });
      const fadeStyle = vars({ "--d0": ms(d0 + dd * 0.85), "--dd": "300ms" });
      const common = { stroke: color, strokeWidth: sw, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
      const dashed = "dashed" in s && s.dashed;
      const strokeProps = dashed
        ? { className: "fade", style: vars({ "--d0": ms(d0), "--dd": ms(dd) }), strokeDasharray: `${6 / unitPx} ${5 / unitPx}` }
        : { className: "draw", style: drawStyle, pathLength: 1 };
      const fillFor = (on?: boolean) =>
        on ? <FillFade key={`f${i}`} color={color} style={fadeStyle} shape={s} /> : null;
      const addLabel = (x: number, y: number, text: string | undefined, anchor: Label["anchor"] = "middle", size = LABEL_PX.md) => {
        if (text) labels.push({ x, y, html: labelHtml(text), color, size, anchor, d0: d0 + dd * 0.8 });
      };

      switch (s.shape) {
        case "line":
        case "arrow": {
          nodes.push(<line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} {...strokeProps} />);
          if (s.shape === "arrow") {
            const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
            const size = 13 / unitPx;
            nodes.push(<polygon key={`h${i}`} points={arrowHead(s.x2, s.y2, ang, size)} fill={color} className="fade" style={fadeStyle} />);
            if (s.double) {
              nodes.push(<polygon key={`t${i}`} points={arrowHead(s.x1, s.y1, ang + Math.PI, size)} fill={color} className="fade" style={fadeStyle} />);
            }
          }
          // Label beside the midpoint, on the upper side of the line.
          const dx = s.x2 - s.x1;
          const dy = s.y2 - s.y1;
          const len = Math.hypot(dx, dy) || 1;
          let nx = -dy / len;
          let ny = dx / len;
          if (ny > 0 || (ny === 0 && nx > 0)) [nx, ny] = [-nx, -ny];
          const off = 18 / unitPx;
          addLabel((s.x1 + s.x2) / 2 + nx * off, (s.y1 + s.y2) / 2 + ny * off, s.label);
          break;
        }
        case "rect":
          nodes.push(fillFor(s.fill));
          nodes.push(<rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={1.2} {...common} {...strokeProps} />);
          addLabel(s.x + s.w / 2, s.y + s.h / 2, s.label);
          break;
        case "circle":
          nodes.push(fillFor(s.fill));
          nodes.push(<circle key={i} cx={s.cx} cy={s.cy} r={s.r} {...common} {...strokeProps} />);
          addLabel(s.cx, s.cy, s.label);
          break;
        case "ellipse":
          nodes.push(fillFor(s.fill));
          nodes.push(<ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} {...strokeProps} />);
          addLabel(s.cx, s.cy, s.label);
          break;
        case "polygon": {
          nodes.push(fillFor(s.fill));
          nodes.push(<polygon key={i} points={s.points.map((p) => p.join(",")).join(" ")} {...common} {...strokeProps} />);
          const cx = s.points.reduce((a, p) => a + p[0], 0) / s.points.length;
          const cy = s.points.reduce((a, p) => a + p[1], 0) / s.points.length;
          addLabel(cx, cy, s.label);
          break;
        }
        case "curve": {
          nodes.push(<path key={i} d={smoothPath(s.points)} {...common} {...strokeProps} />);
          const last = s.points[s.points.length - 1];
          addLabel(last[0] + 2, last[1] - 3, s.label, "start");
          break;
        }
        case "arc": {
          let a1 = s.start;
          let a2 = s.end;
          if (a2 < a1) [a1, a2] = [a2, a1];
          if (a2 - a1 >= 360) a2 = a1 + 359.9;
          const [sx, sy] = polar(s.cx, s.cy, s.r, a1);
          const [ex, ey] = polar(s.cx, s.cy, s.r, a2);
          const large = a2 - a1 > 180 ? 1 : 0;
          nodes.push(<path key={i} d={`M ${sx} ${sy} A ${s.r} ${s.r} 0 ${large} 0 ${ex} ${ey}`} {...common} {...strokeProps} />);
          const [lx, ly] = polar(s.cx, s.cy, s.r + 16 / unitPx, (a1 + a2) / 2);
          addLabel(lx, ly, s.label, "middle", LABEL_PX.sm);
          break;
        }
        case "point": {
          nodes.push(<circle key={i} cx={s.x} cy={s.y} r={5 / unitPx} fill={color} className="fade" style={drawStyle} />);
          addLabel(s.x + 9 / unitPx, s.y - 12 / unitPx, s.label, "start");
          break;
        }
        case "text":
          addLabel(s.x, s.y, s.text, "middle", LABEL_PX[s.size ?? "md"]);
          labels[labels.length - 1].d0 = d0;
          break;
      }
    });
    return { nodes, labels };
  }, [item, timing, slot, sw, unitPx]);

  return (
    <figure>
      <div className="b-svg-wrap" style={{ aspectRatio: `${vw} / ${H}` }}>
        <svg viewBox={`${vx} ${vy} ${vw} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
          {nodes}
        </svg>
        {labels.map((l, i) => (
          <span
            key={i}
            className="b-label fade"
            style={{
              left: `${((l.x - vx) / vw) * 100}%`,
              top: `${((l.y - vy) / H) * 100}%`,
              color: l.color,
              fontSize: l.size,
              transform: `translate(${l.anchor === "start" ? "0" : l.anchor === "end" ? "-100%" : "-50%"}, -50%)`,
              ...vars({ "--d0": ms(l.d0), "--dd": "320ms" }),
            }}
            dangerouslySetInnerHTML={{ __html: l.html }}
          />
        ))}
      </div>
      {item.caption && (
        <figcaption className="b-caption fade" style={vars({ "--d0": timing ? ms(timing.start + timing.dur) : undefined, "--dd": "300ms" })}>
          {item.caption}
        </figcaption>
      )}
    </figure>
  );
}

function FillFade({ color, style, shape }: { color: string; style: React.CSSProperties; shape: Shape }) {
  const p = { fill: color, fillOpacity: 0.14, stroke: "none", className: "fade", style };
  switch (shape.shape) {
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={1.2} {...p} />;
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...p} />;
    case "ellipse":
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...p} />;
    case "polygon":
      return <polygon points={shape.points.map((pt) => pt.join(",")).join(" ")} {...p} />;
    default:
      return null;
  }
}
