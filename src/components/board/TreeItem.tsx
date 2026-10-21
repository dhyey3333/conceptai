"use client";

import { useMemo } from "react";
import type { ItemOf } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { layoutTree } from "@/lib/board/treeLayout";
import { labelHtml } from "@/lib/math/render";
import { ink, ms, vars } from "./text-items";

const MAX_H = 560;
const LABEL_PX = 20;

/** A tree laid out by the board: drawn level by level, each edge just before the node it leads to. */
export function TreeItem({ item, timing, width }: { item: ItemOf<"tree">; timing: ItemTiming | null; width: number }) {
  const layout = useMemo(() => layoutTree(item), [item]);
  const scale = Math.min(1, width / layout.width, MAX_H / layout.height);
  const W = layout.width * scale;
  const H = layout.height * scale;
  const t0 = timing?.start ?? 0;
  const slot = timing ? timing.dur / layout.nodes.length : 0;
  const at = (order: number) => t0 + order * slot;
  const font = Math.max(12, LABEL_PX * scale);

  return (
    <figure>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div className="b-svg-wrap" style={{ width: W, height: H }}>
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
            {layout.edges.map((e) => (
              <line
                key={`e${e.to}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke="var(--ink-white)"
                strokeOpacity={0.8}
                strokeWidth={2.4}
                strokeLinecap="round"
                pathLength={1}
                className="draw"
                style={vars({ "--d0": ms(at(e.order)), "--dd": ms(Math.max(200, slot * 0.4)) })}
              />
            ))}
            {layout.nodes.map((n) => {
              const color = n.highlighted ? ink("yellow") : ink(n.color ?? item.color);
              const style = vars({ "--d0": ms(at(n.order) + slot * 0.35), "--dd": ms(Math.max(220, slot * 0.45)) });
              const common = {
                stroke: color,
                strokeWidth: n.highlighted ? 3.2 : 2.6,
                fill: n.highlighted ? color : "rgb(255 255 255 / 0.03)",
                fillOpacity: n.highlighted ? 0.18 : 1,
                pathLength: 1,
                className: "draw",
                style,
              };
              return n.round ? (
                <circle key={n.id} cx={n.x} cy={n.y} r={n.w / 2} {...common} />
              ) : (
                <rect key={n.id} x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={12} {...common} />
              );
            })}
          </svg>
          {layout.nodes.map((n) => (
            <span
              key={`l${n.id}`}
              className="b-label fade"
              style={{
                left: `${(n.x / layout.width) * 100}%`,
                top: `${(n.y / layout.height) * 100}%`,
                color: n.highlighted ? ink("yellow") : ink(n.color ?? item.color),
                fontSize: font,
                ...vars({ "--d0": ms(at(n.order) + slot * 0.7), "--dd": "260ms" }),
              }}
              dangerouslySetInnerHTML={{ __html: labelHtml(n.label) }}
            />
          ))}
          {layout.edges
            .filter((e) => e.label)
            .map((e) => {
              const right = e.x2 >= e.x1;
              return (
                <span
                  key={`el${e.to}`}
                  className="b-label fade"
                  style={{
                    left: `${(((e.x1 + e.x2) / 2 + (right ? 8 : -8)) / layout.width) * 100}%`,
                    top: `${((e.y1 + e.y2) / 2 / layout.height) * 100}%`,
                    color: "var(--ink-muted)",
                    fontSize: Math.max(11, 16 * scale),
                    transform: `translate(${right ? "0" : "-100%"}, -50%)`,
                    ...vars({ "--d0": ms(at(e.order) + slot * 0.3), "--dd": "260ms" }),
                  }}
                  dangerouslySetInnerHTML={{ __html: labelHtml(e.label!) }}
                />
              );
            })}
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
