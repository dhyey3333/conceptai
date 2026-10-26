"use client";

import { useMemo } from "react";
import type { ItemOf } from "@/lib/board/schema";
import { tokenizeLine } from "@/lib/board/highlight";
import type { ItemTiming } from "@/lib/board/timing";
import { cn } from "@/lib/utils";
import { ms, useFitFont, vars } from "./text-items";

const LANG_NAME: Record<string, string> = {
  python: "Python",
  pseudocode: "Pseudocode",
  c: "C",
  cpp: "C++",
  java: "Java",
  javascript: "JavaScript",
  sql: "SQL",
};

/**
 * Code written line by line, with syntax colours. Under it, what really
 * happened when the code was run (Python only, by the local helper): its
 * output, or the error and the line it happened on.
 */
export function CodeItem({ item, timing }: { item: ItemOf<"code">; timing: ItemTiming | null }) {
  const lines = useMemo(() => item.code.split("\n").map((l) => tokenizeLine(l, item.lang)), [item.code, item.lang]);
  const [ref, fontSize] = useFitFont<HTMLDivElement>(item.code);
  const run = item.run;
  // The code takes most of the item's time; the result appears as the writing ends.
  const slot = timing ? (timing.dur * (run ? 0.85 : 1)) / lines.length : 0;
  const end = timing ? timing.start + slot * lines.length : 0;
  const marked = new Set([...(item.highlight ?? []), ...(run && !run.ok && run.line ? [run.line] : [])]);
  const output = run?.output.replace(/\n+$/, "");
  return (
    <div className="b-code">
      <div className="b-code-head fade" style={vars({ "--d0": timing ? ms(timing.start) : undefined, "--dd": "300ms" })}>
        <span className="b-code-lang">{LANG_NAME[item.lang] ?? item.lang}</span>
        {item.caption && <span className="b-code-caption">{item.caption}</span>}
      </div>
      <div ref={ref} className="b-code-body" style={{ fontSize }}>
        {lines.map((tokens, i) => (
          <div
            key={i}
            className={cn("b-code-line sweep", marked.has(i + 1) && (run && !run.ok && run.line === i + 1 ? "is-error" : "is-marked"))}
            style={vars({ "--d0": ms(timing ? timing.start + i * slot : 0), "--dd": ms(slot * 0.85) })}
          >
            <span className="b-code-no">{i + 1}</span>
            <span className="b-code-text">
              {tokens.map((t, j) =>
                t.kind === "plain" ? (
                  t.text
                ) : (
                  <span key={j} className={`tok-${t.kind}`}>
                    {t.text}
                  </span>
                ),
              )}
            </span>
          </div>
        ))}
      </div>
      {run && (
        <div
          className={cn("b-code-run fade", !run.ok && "is-error")}
          style={vars({ "--d0": timing ? ms(end) : undefined, "--dd": ms(Math.max(300, slot)) })}
          title="This is what the code printed when it was actually run on this computer."
        >
          <div className="b-code-run-tag">{run.ok ? (output ? "Output (actually run)" : "Ran without errors") : "Error when run"}</div>
          {output && <pre>{output}</pre>}
          {!run.ok && <pre className="b-code-error">{run.line ? `Line ${run.line}: ${run.error}` : run.error}</pre>}
        </div>
      )}
    </div>
  );
}
