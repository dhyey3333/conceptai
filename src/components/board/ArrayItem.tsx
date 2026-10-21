"use client";

import { useMemo } from "react";
import type { ItemOf } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { labelHtml } from "@/lib/math/render";
import { ink, ms, vars } from "./text-items";

const CELL_H = 52;
const POINTER_H = 58;
const INDEX_H = 28;
const CHAR_PX = 13;

const visible = (s: string) => s.replace(/\$|\\[a-zA-Z]+|[{}^_]/g, "");

/**
 * A row of cells laid out by the board, with optional index numbers, named
 * pointers (low / mid / high) and highlighted or greyed-out cells: the picture
 * of an array at one step of an algorithm.
 */
export function ArrayItem({ item, timing, width }: { item: ItemOf<"array">; timing: ItemTiming | null; width: number }) {
  const base = item.start ?? 0;
  const n = item.values.length;
  const geo = useMemo(() => {
    const chars = Math.max(1, ...item.values.map((v) => visible(v).length));
    const cellW = Math.max(52, Math.min(130, chars * CHAR_PX + 26));
    const nameW = item.label ? visible(item.label).length * CHAR_PX + 40 : 0;
    // Pointers that share a cell share one marker ("low, mid").
    const pointers = new Map<number, { labels: string[]; color?: string }>();
    for (const p of item.pointers ?? []) {
      const at = p.index - base;
      const cur = pointers.get(at) ?? { labels: [], color: p.color };
      cur.labels.push(p.label);
      pointers.set(at, cur);
    }
    const top = pointers.size ? POINTER_H : 6;
    const bottom = item.indices === false ? 6 : INDEX_H;
    return { cellW, nameW, pointers, top, W: nameW + n * cellW + 4, H: top + CELL_H + bottom };
  }, [item, base, n]);
  const { cellW, nameW, pointers, top, W, H } = geo;
  const scale = Math.min(1, width / W);
  const highlight = new Set((item.highlight ?? []).map((i) => i - base));
  const dim = new Set((item.dim ?? []).map((i) => i - base));
  const color = ink(item.color);

  // Cells left to right over most of the slot; pointers at the end.
  const t0 = timing?.start ?? 0;
  const dur = timing?.dur ?? 0;
  const cellSlot = (dur * (pointers.size ? 0.75 : 0.95)) / n;
  const cellAt = (i: number) => t0 + i * cellSlot;
  const pointerAt = t0 + dur * 0.78;
  const x0 = nameW + 2;
  const pct = (x: number, y: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });

  return (
    <figure>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div className="b-svg-wrap" style={{ width: W * scale, height: H * scale }}>
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
            {item.values.map((_, i) => {
              const lit = highlight.has(i);
              const stroke = lit ? ink("yellow") : color;
              return (
                <rect
                  key={i}
                  x={x0 + i * cellW}
                  y={top}
                  width={cellW}
                  height={CELL_H}
                  stroke={stroke}
                  strokeOpacity={dim.has(i) ? 0.45 : 1}
                  strokeWidth={lit ? 3.2 : 2.4}
                  fill={lit ? stroke : "rgb(255 255 255 / 0.03)"}
                  fillOpacity={lit ? 0.18 : 1}
                  pathLength={1}
                  className="draw"
                  style={vars({ "--d0": ms(cellAt(i)), "--dd": ms(Math.max(180, cellSlot * 0.7)) })}
                />
              );
            })}
            {[...pointers].map(([i, p]) => {
              const cx = x0 + i * cellW + cellW / 2;
              return (
                <path
                  key={`p${i}`}
                  d={`M ${cx} ${top - 30} L ${cx} ${top - 6} M ${cx - 7} ${top - 14} L ${cx} ${top - 5} L ${cx + 7} ${top - 14}`}
                  fill="none"
                  stroke={ink(p.color ?? "blue")}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  className="draw"
                  style={vars({ "--d0": ms(pointerAt), "--dd": "320ms" })}
                />
              );
            })}
          </svg>
          {item.label && (
            <span
              className="b-label fade"
              style={{ ...pct(nameW - 14, top + CELL_H / 2), color, fontSize: 22 * scale, transform: "translate(-100%, -50%)", ...vars({ "--d0": ms(t0), "--dd": "260ms" }) }}
              dangerouslySetInnerHTML={{ __html: labelHtml(`${item.label} =`) }}
            />
          )}
          {item.values.map((v, i) =>
            v ? (
              <span
                key={`v${i}`}
                className="b-label fade"
                style={{
                  ...pct(x0 + i * cellW + cellW / 2, top + CELL_H / 2),
                  color: highlight.has(i) ? ink("yellow") : color,
                  opacity: dim.has(i) ? 0.38 : undefined,
                  fontSize: 21 * scale,
                  ...vars({ "--d0": ms(cellAt(i) + cellSlot * 0.55), "--dd": "220ms" }),
                }}
                dangerouslySetInnerHTML={{ __html: labelHtml(v) }}
              />
            ) : null,
          )}
          {item.indices !== false &&
            item.values.map((_, i) => (
              <span
                key={`i${i}`}
                className="b-label fade"
                style={{
                  ...pct(x0 + i * cellW + cellW / 2, top + CELL_H + INDEX_H / 2 + 1),
                  color: "var(--ink-muted)",
                  fontSize: Math.max(11, 15 * scale),
                  ...vars({ "--d0": ms(cellAt(i) + cellSlot * 0.6), "--dd": "220ms" }),
                }}
              >
                {i + base}
              </span>
            ))}
          {[...pointers].map(([i, p]) => (
            <span
              key={`pl${i}`}
              className="b-label fade"
              style={{
                ...pct(x0 + i * cellW + cellW / 2, top - 44),
                color: ink(p.color ?? "blue"),
                fontSize: Math.max(12, 17 * scale),
                ...vars({ "--d0": ms(pointerAt + 150), "--dd": "260ms" }),
              }}
              dangerouslySetInnerHTML={{ __html: labelHtml(p.labels.join(", ")) }}
            />
          ))}
        </div>
      </div>
      {item.caption && (
        <figcaption className="b-caption fade" style={vars({ "--d0": timing ? ms(timing.start + timing.dur) : undefined, "--dd": "300ms" })}>
          {item.caption}
        </figcaption>
      )}
    </figure>
  );
}
