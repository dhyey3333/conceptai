"use client";

import { useMemo, type CSSProperties } from "react";
import type { ItemOf } from "@/lib/board/schema";
import type { ItemTiming } from "@/lib/board/timing";
import { renderLatex, richHtml, richTokensHtml } from "@/lib/math/render";
import { cn } from "@/lib/utils";

export const ms = (n: number) => `${Math.max(0, Math.round(n))}ms`;
export const vars = (o: Record<string, string | number | undefined>) => o as CSSProperties;
export const ink = (c?: string, fallback = "white") => `var(--ink-${c ?? fallback})`;

/** Words and formulas appear one after another across the item's time slot. */
export function InkText({
  text,
  timing,
  className,
  style,
}: {
  text: string;
  timing: ItemTiming | null;
  className?: string;
  style?: CSSProperties;
}) {
  const { html, count } = useMemo(() => richTokensHtml(text), [text]);
  const step = timing ? timing.dur / Math.max(count, 1) : 0;
  return (
    <div
      className={className}
      style={{ ...style, ...vars({ "--step": ms(step), "--wdur": ms(Math.min(420, Math.max(150, step * 1.7))) }) }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The glowing chalk tip that rides along a line of writing. */
export function Pen({ width, y = 24 }: { width: number; y?: number }) {
  return <span className="pen" aria-hidden style={vars({ "--pen-x": `${width}px`, "--pen-y": `${y}px` })} />;
}

const TONE_TAG: Record<string, string> = {
  definition: "Definition",
  important: "Important",
  example: "Example",
  tip: "Remember",
  question: "You asked",
};

export function TextItem({ item, timing, width }: { item: ItemOf<"text">; timing: ItemTiming | null; width: number }) {
  const tone = item.tone ?? "normal";
  const tag = TONE_TAG[tone];
  const approxWidth = Math.min(width, item.text.length * 13);
  return (
    <div className={cn("b-text", `tone-${tone}`)} style={{ color: item.color ? ink(item.color) : undefined }}>
      {tag && (
        <div>
          <span className="b-tag fade" style={vars({ "--d0": timing ? ms(timing.start) : undefined, "--dd": "300ms" })}>
            {tag}
          </span>
        </div>
      )}
      <InkText text={item.text} timing={timing} />
      <Pen width={approxWidth} y={tag ? 54 : 20} />
    </div>
  );
}

export function TitleItem({ item, timing, kind }: { item: ItemOf<"title" | "heading">; timing: ItemTiming | null; kind: "title" | "heading" }) {
  const isTitle = kind === "title";
  const underlineW = Math.min(isTitle ? 900 : 700, item.text.length * (isTitle ? 27 : 19) + 20);
  const underlineDelay = timing ? timing.start + timing.dur * 0.7 : 0;
  const underlineDur = timing ? timing.dur * 0.3 : 0;
  return (
    <div className={isTitle ? "b-title" : "b-heading"} style={{ color: item.color ? ink(item.color) : undefined }}>
      <InkText text={item.text} timing={timing ? { start: timing.start, dur: timing.dur * 0.7 } : null} />
      <svg width={underlineW} height="14" viewBox={`0 0 ${underlineW} 14`} style={{ display: "block", marginTop: 2 }} aria-hidden>
        <path
          d={`M 2 ${isTitle ? 9 : 7} C ${underlineW * 0.3} ${isTitle ? 3 : 5}, ${underlineW * 0.65} ${isTitle ? 13 : 10}, ${underlineW - 2} ${isTitle ? 6 : 6}`}
          pathLength={1}
          className="draw"
          fill="none"
          stroke={isTitle ? "var(--ink-yellow)" : "var(--ink-blue)"}
          strokeOpacity={0.75}
          strokeWidth={isTitle ? 3.5 : 2.5}
          strokeLinecap="round"
          style={vars({ "--d0": ms(underlineDelay), "--dd": ms(underlineDur) })}
        />
      </svg>
      <Pen width={Math.min(underlineW, 860)} y={isTitle ? 30 : 22} />
    </div>
  );
}

export function BulletsItem({ item, timing }: { item: ItemOf<"bullets">; timing: ItemTiming | null }) {
  const lines = useMemo(() => {
    let start = 0;
    return item.items.map((t) => {
      const r = richTokensHtml(t, start);
      start += r.count;
      return r.html;
    });
  }, [item.items]);
  const total = useMemo(() => item.items.reduce((s, t) => s + richTokensHtml(t).count, 0), [item.items]);
  const step = timing ? timing.dur / Math.max(total, 1) : 0;
  return (
    <ul
      className="b-bullets"
      style={{ ...vars({ "--step": ms(step), "--wdur": ms(Math.min(420, Math.max(150, step * 1.7))) }), color: item.color ? ink(item.color) : undefined }}
    >
      {lines.map((html, i) => (
        <li key={i}>
          <span className="marker">{item.ordered ? `${i + 1}.` : "•"}</span>
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </li>
      ))}
    </ul>
  );
}

export function MathItem({ item, timing }: { item: ItemOf<"math">; timing: ItemTiming | null }) {
  const html = useMemo(() => renderLatex(item.latex, true), [item.latex]);
  const writeDur = timing ? timing.dur * (item.label ? 0.85 : 1) : 0;
  return (
    <div className={cn("b-math", item.boxed && "boxed")} style={{ color: item.color ? ink(item.color) : undefined }}>
      <div
        className="math-inner sweep"
        style={vars({ "--d0": timing ? ms(timing.start) : undefined, "--dd": ms(writeDur) })}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {item.label && (
        <div className="b-math-label fade" style={vars({ "--d0": timing ? ms(timing.start + writeDur) : undefined, "--dd": "350ms" })}>
          {item.label}
        </div>
      )}
    </div>
  );
}

export function StepsItem({ item, timing }: { item: ItemOf<"steps">; timing: ItemTiming | null }) {
  const lines = useMemo(() => item.lines.map((l) => renderLatex(l.latex, true)), [item.lines]);
  const slot = timing ? timing.dur / lines.length : 0;
  return (
    <div className="b-steps" style={{ color: item.color ? ink(item.color) : undefined }}>
      {lines.map((html, i) => {
        const d0 = timing ? timing.start + i * slot : 0;
        return (
          <div key={i} className="b-step">
            <div className="sweep" style={vars({ "--d0": ms(d0), "--dd": ms(slot * 0.78) })} dangerouslySetInnerHTML={{ __html: html }} />
            {item.lines[i].note && (
              <div className="b-step-note fade" style={vars({ "--d0": ms(d0 + slot * 0.75), "--dd": ms(Math.max(200, slot * 0.25)) })}>
                ← {item.lines[i].note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TableItem({ item, timing }: { item: ItemOf<"table">; timing: ItemTiming | null }) {
  const rows = item.rows.length + 1;
  const slot = timing ? timing.dur / rows : 0;
  const cellHtml = (t: string) => ({ __html: richHtml(t) });
  return (
    <table className="b-table" style={{ color: item.color ? ink(item.color) : undefined }}>
      <thead>
        <tr className="fade" style={vars({ "--d0": timing ? ms(timing.start) : undefined, "--dd": ms(slot) })}>
          {item.headers.map((h, i) => (
            <th key={i} dangerouslySetInnerHTML={cellHtml(h)} />
          ))}
        </tr>
      </thead>
      <tbody>
        {item.rows.map((r, ri) => (
          <tr key={ri} className="fade" style={vars({ "--d0": timing ? ms(timing.start + (ri + 1) * slot) : undefined, "--dd": ms(slot) })}>
            {item.headers.map((_, ci) => (
              <td key={ci} dangerouslySetInnerHTML={cellHtml(r[ci] ?? "")} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
