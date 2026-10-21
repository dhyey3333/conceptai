"use client";

import { useId, useMemo } from "react";
import type { ItemOf } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { compileExpr, sample } from "@/lib/board/expr";
import { labelHtml, richHtml } from "@/lib/math/render";
import { ink, ms, vars } from "./text-items";

const CURVE_COLORS = ["yellow", "blue", "green", "pink"] as const;
const M = { l: 52, r: 18, t: 16, b: 40 };

function niceStep(span: number, target = 6): number {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

function fmt(n: number): string {
  if (Math.abs(n) < 1e-9) return "0";
  if (Math.abs(n) >= 1e4 || Math.abs(n) < 1e-3) return n.toExponential(0);
  return String(Math.round(n * 1000) / 1000);
}

export function PlotItem({ item, timing, width }: { item: ItemOf<"plot">; timing: ItemTiming | null; width: number }) {
  const clipId = useId().replace(/:/g, "");
  const W = width;
  const H = Math.round(Math.min(440, Math.max(260, width * 0.62)));

  const model = useMemo(() => {
    const curves = (item.functions ?? []).map((f, i) => {
      try {
        const fn = compileExpr(f.expr);
        return { ...f, color: f.color ?? CURVE_COLORS[i % CURVE_COLORS.length], samples: sample(fn, item.xMin, item.xMax), ok: true };
      } catch {
        return { ...f, color: f.color ?? "red", samples: [], ok: false };
      }
    });

    // Y range: use what the model gave, otherwise fit the data, ignoring
    // extreme 3% tails so an asymptote (tan x, 1/x) doesn't flatten the curve.
    let yMin = item.yMin;
    let yMax = item.yMax;
    if (yMin === undefined || yMax === undefined) {
      const ys = curves.flatMap((c) => c.samples.map((s) => s.y).filter((y): y is number => y !== null));
      (item.points ?? []).forEach((p) => ys.push(p.y));
      ys.sort((a, b) => a - b);
      const lo = ys.length ? ys[Math.floor(ys.length * 0.03)] : -1;
      const hi = ys.length ? ys[Math.min(ys.length - 1, Math.ceil(ys.length * 0.97) - 1)] : 1;
      let a = Math.min(lo, ...(item.points ?? []).map((p) => p.y));
      let b = Math.max(hi, ...(item.points ?? []).map((p) => p.y));
      if (!(b > a)) {
        a -= 1;
        b += 1;
      }
      // Show the x-axis when the data comes reasonably close to it.
      const span = b - a;
      if (a > 0 && a < span * 0.6) a = 0;
      if (b < 0 && -b < span * 0.6) b = 0;
      const pad = (b - a) * 0.08;
      yMin ??= a - (a === 0 ? 0 : pad);
      yMax ??= b + pad;
    }
    if (!(yMax! > yMin!)) yMax = yMin! + 1;

    const xs = (x: number) => M.l + ((x - item.xMin) / (item.xMax - item.xMin)) * (W - M.l - M.r);
    const ys = (y: number) => M.t + (1 - (y - yMin!) / (yMax! - yMin!)) * (H - M.t - M.b);
    const ySpan = yMax! - yMin!;

    const paths = curves.map((c) => {
      let d = "";
      let pen = false;
      let prev: number | null = null;
      let end: [number, number] | null = null;
      for (const s of c.samples) {
        const visible = s.y !== null && s.y > yMin! - ySpan * 2 && s.y < yMax! + ySpan * 2;
        // Break the line at gaps and at asymptote-sized jumps.
        if (!visible || (prev !== null && Math.abs(s.y! - prev) > ySpan * 1.5)) {
          pen = false;
          prev = visible ? s.y : null;
          if (!visible) continue;
        }
        const px = xs(s.x);
        const py = ys(s.y!);
        d += `${pen ? "L" : "M"} ${px.toFixed(1)} ${py.toFixed(1)} `;
        pen = true;
        prev = s.y;
        if (s.y! >= yMin! && s.y! <= yMax!) end = [px, py];
      }
      return { ...c, d, end };
    });

    const xStep = niceStep(item.xMax - item.xMin);
    const yStep = niceStep(yMax! - yMin!, 5);
    const xTicks: number[] = [];
    for (let v = Math.ceil(item.xMin / xStep) * xStep; v <= item.xMax + 1e-9; v += xStep) xTicks.push(v);
    const yTicks: number[] = [];
    for (let v = Math.ceil(yMin! / yStep) * yStep; v <= yMax! + 1e-9; v += yStep) yTicks.push(v);

    const axisX = Math.min(Math.max(0, item.xMin), item.xMax); // where the y-axis sits
    const axisY = Math.min(Math.max(0, yMin!), yMax!); // where the x-axis sits
    return { paths, xs, ys, xTicks, yTicks, axisX, axisY, yMin: yMin!, yMax: yMax! };
  }, [item, W, H]);

  const t0 = timing?.start ?? 0;
  const dur = timing?.dur ?? 0;
  const axesD = { "--d0": ms(t0), "--dd": ms(dur * 0.22) };
  const gridD = { "--d0": ms(t0 + dur * 0.12), "--dd": ms(dur * 0.15) };
  const curveSlot = (dur * 0.6) / Math.max(1, model.paths.length);
  const afterCurves = t0 + dur * 0.85;

  const { xs, ys } = model;
  const ox = xs(model.axisX);
  const oy = ys(model.axisY);

  return (
    <div className="b-svg-wrap" style={{ width: W, height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <clipPath id={clipId}>
            <rect x={M.l} y={M.t - 2} width={W - M.l - M.r} height={H - M.t - M.b + 4} />
          </clipPath>
        </defs>
        <g className="fade" style={vars(gridD)} stroke="var(--ink-white)" strokeOpacity={0.09} strokeWidth={1}>
          {model.xTicks.map((v) => (
            <line key={`gx${v}`} x1={xs(v)} x2={xs(v)} y1={M.t} y2={H - M.b} />
          ))}
          {model.yTicks.map((v) => (
            <line key={`gy${v}`} x1={M.l} x2={W - M.r} y1={ys(v)} y2={ys(v)} />
          ))}
        </g>
        {/* axes */}
        <line x1={M.l - 4} y1={oy} x2={W - M.r + 4} y2={oy} stroke="var(--ink-white)" strokeWidth={2} pathLength={1} className="draw" style={vars(axesD)} />
        <line x1={ox} y1={H - M.b + 4} x2={ox} y2={M.t - 6} stroke="var(--ink-white)" strokeWidth={2} pathLength={1} className="draw" style={vars(axesD)} />
        <polygon points={`${W - M.r + 10},${oy} ${W - M.r},${oy - 5} ${W - M.r},${oy + 5}`} fill="var(--ink-white)" className="fade" style={vars(gridD)} />
        <polygon points={`${ox},${M.t - 12} ${ox - 5},${M.t - 2} ${ox + 5},${M.t - 2}`} fill="var(--ink-white)" className="fade" style={vars(gridD)} />
        <g clipPath={`url(#${clipId})`}>
          {model.paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill="none"
              stroke={ink(p.color)}
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="draw"
              style={vars({ "--d0": ms(t0 + dur * 0.25 + i * curveSlot), "--dd": ms(curveSlot) })}
            />
          ))}
        </g>
        {/* Tick numbers sit above the curves, with a halo in the board colour so a curve never hides them. */}
        <g
          className="fade"
          style={vars(gridD)}
          fill="var(--ink-muted)"
          fontSize={14}
          fontFamily="var(--font-sans)"
          stroke="var(--board-bg)"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {model.xTicks.map((v) =>
            Math.abs(v - model.axisX) < 1e-9 && model.axisX !== item.xMin ? null : (
              <text key={`tx${v}`} x={xs(v)} y={Math.min(H - M.b + 18, oy + 18)} textAnchor="middle">
                {fmt(v)}
              </text>
            ),
          )}
          {model.yTicks.map((v) =>
            Math.abs(v - model.axisY) < 1e-9 ? null : (
              <text key={`ty${v}`} x={Math.max(M.l - 8, ox - 8)} y={ys(v) + 5} textAnchor="end">
                {fmt(v)}
              </text>
            ),
          )}
        </g>
        {(item.points ?? []).map((pt, i) => (
          <circle
            key={i}
            cx={xs(pt.x)}
            cy={ys(pt.y)}
            r={5.5}
            fill="var(--ink-orange)"
            className="fade"
            style={vars({ "--d0": ms(afterCurves + i * 80), "--dd": "260ms" })}
          />
        ))}
      </svg>
      {model.paths.map((p, i) =>
        p.end && (p.label || !p.ok) ? (
          <span
            key={`l${i}`}
            className="b-label fade"
            style={{
              left: Math.min(p.end[0], W - 40),
              top: Math.max(14, p.end[1] - 18),
              transform: "translate(-100%, -50%)",
              color: ink(p.color),
              fontSize: 19,
              ...vars({ "--d0": ms(afterCurves), "--dd": "300ms" }),
            }}
            dangerouslySetInnerHTML={{ __html: labelHtml(p.label ?? p.expr) }}
          />
        ) : null,
      )}
      {(item.points ?? []).map((pt, i) =>
        pt.label ? (
          <span
            key={`p${i}`}
            className="b-label fade"
            style={{
              left: xs(pt.x) + 10,
              top: ys(pt.y) - 14,
              transform: "translate(0, -50%)",
              color: "var(--ink-orange)",
              fontSize: 17,
              ...vars({ "--d0": ms(afterCurves + i * 80), "--dd": "260ms" }),
            }}
            dangerouslySetInnerHTML={{ __html: richHtml(pt.label) }}
          />
        ) : null,
      )}
      {item.xLabel && (
        <span className="b-label fade" style={{ left: W - M.r, top: Math.min(H - 10, oy + 32), transform: "translate(-100%, -50%)", fontSize: 18, color: "var(--ink-muted)", ...vars(gridD) }} dangerouslySetInnerHTML={{ __html: richHtml(item.xLabel) }} />
      )}
      {item.yLabel && (
        <span className="b-label fade" style={{ left: ox + 10, top: M.t + 2, transform: "translate(0, -50%)", fontSize: 18, color: "var(--ink-muted)", ...vars(gridD) }} dangerouslySetInnerHTML={{ __html: richHtml(item.yLabel) }} />
      )}
      {model.paths.some((p) => !p.ok) && (
        <span className="b-label" style={{ left: "50%", top: "50%", fontSize: 16, color: "var(--ink-red)" }}>
          Couldn&apos;t plot: {model.paths.filter((p) => !p.ok).map((p) => p.expr).join(", ")}
        </span>
      )}
    </div>
  );
}
