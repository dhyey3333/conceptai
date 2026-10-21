"use client";

import { useMemo } from "react";
import type { ItemOf } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { layoutFlowchart, wrapLabel } from "@/lib/board/flowLayout";
import { escapeHtml, richHtml } from "@/lib/math/render";
import { ink, ms, vars } from "./text-items";

const MAX_H = 620;

export function FlowchartItem({ item, timing, width }: { item: ItemOf<"flowchart">; timing: ItemTiming | null; width: number }) {
  const layout = useMemo(() => layoutFlowchart(item), [item]);
  const scale = Math.min(1, width / layout.width, MAX_H / layout.height);
  const W = layout.width * scale;
  const H = layout.height * scale;
  const color = ink(item.color);

  // Draw rank by rank: a node's box, then its label, then its outgoing arrows.
  const ranks = Math.max(...layout.nodes.map((n) => n.order)) + 1;
  const t0 = timing?.start ?? 0;
  const slot = (timing?.dur ?? 0) / ranks;
  const rankOf = new Map(layout.nodes.map((n) => [n.id, n.order]));

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div className="b-svg-wrap" style={{ width: W, height: H }}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
          {layout.edges.map((e, i) => {
            const d0 = t0 + rankOf.get(e.from)! * slot + slot * 0.55;
            const dd = slot * 0.5;
            const [hx, hy, ha] = e.head;
            const s = 11;
            return (
              <g key={i}>
                <path
                  d={e.path}
                  fill="none"
                  stroke="var(--ink-white)"
                  strokeOpacity={0.85}
                  strokeWidth={2.2}
                  pathLength={1}
                  className="draw"
                  style={vars({ "--d0": ms(d0), "--dd": ms(dd) })}
                />
                <polygon
                  points={`${hx},${hy} ${hx - s * Math.cos(ha - 0.45)},${hy - s * Math.sin(ha - 0.45)} ${hx - s * Math.cos(ha + 0.45)},${hy - s * Math.sin(ha + 0.45)}`}
                  fill="var(--ink-white)"
                  className="fade"
                  style={vars({ "--d0": ms(d0 + dd * 0.9), "--dd": "200ms" })}
                />
              </g>
            );
          })}
          {layout.nodes.map((n) => {
            const d0 = t0 + n.order * slot;
            const style = vars({ "--d0": ms(d0), "--dd": ms(slot * 0.45) });
            const common = {
              fill: "rgb(255 255 255 / 0.03)",
              stroke: color,
              strokeWidth: 2.4,
              pathLength: 1,
              className: "draw",
              style,
            };
            const { x, y, w, h } = n;
            if (n.shape === "diamond")
              return <polygon key={n.id} points={`${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`} {...common} />;
            if (n.shape === "circle") return <ellipse key={n.id} cx={x} cy={y} rx={w / 2} ry={h / 2} {...common} />;
            return <rect key={n.id} x={x - w / 2} y={y - h / 2} width={w} height={h} rx={n.shape === "round" ? h / 2 : 12} {...common} />;
          })}
        </svg>
        {layout.nodes.map((n) => (
          <span
            key={n.id}
            className="b-node-label fade"
            style={{
              left: n.x * scale,
              top: n.y * scale,
              fontSize: 19 * scale,
              lineHeight: `${24 * scale}px`,
              ...vars({ "--d0": ms(t0 + n.order * slot + slot * 0.35), "--dd": ms(slot * 0.25) }),
            }}
            dangerouslySetInnerHTML={{ __html: wrapLabel(n.label).map((l) => (l.includes("$") ? richHtml(l) : escapeHtml(l))).join("<br/>") }}
          />
        ))}
        {layout.edges.map((e, i) =>
          e.label ? (
            <span
              key={`el${i}`}
              className="b-label fade"
              style={{
                left: e.mid[0] * scale,
                top: e.mid[1] * scale,
                fontSize: 16 * Math.max(scale, 0.8),
                color: "var(--ink-green)",
                background: "var(--board-bg)",
                padding: "0 4px",
                borderRadius: 4,
                ...vars({ "--d0": ms(t0 + rankOf.get(e.from)! * slot + slot * 0.9), "--dd": "250ms" }),
              }}
              dangerouslySetInnerHTML={{ __html: richHtml(e.label) }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
