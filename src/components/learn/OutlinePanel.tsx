"use client";

import { Check, CircleX, ExternalLink, Globe, RotateCcw } from "lucide-react";
import type { LessonSession, SessionState } from "@/lib/lesson/session";
import { cn, hostOf } from "@/lib/utils";
import { Spinner } from "@/components/ui";

export function OutlinePanel({ s, session }: { s: SessionState; session: LessonSession }) {
  const o = s.lesson.outline;
  const current = s.timeline[Math.min(s.index, s.timeline.length - 1)]?.sectionIndex ?? 0;
  if (!o) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted">
        {s.lesson.status === "error" ? "No lesson plan yet." : <Spinner size={20} />}
        {s.lesson.status !== "error" && "Planning the lesson…"}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{o.subject}</div>
        <h2 className="mt-1 text-lg font-semibold leading-snug">{o.title}</h2>
        {o.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{o.summary}</p>}
      </div>
      {!!o.objectives.length && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">You will learn to</div>
          <ul className="space-y-1.5">
            {o.objectives.map((ob, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-fg/90">
                <Check size={14} className="mt-0.5 shrink-0 text-accent-2" />
                {ob}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Lesson outline</div>
        <ol className="space-y-1">
          {o.sections.map((sec, i) => {
            const st = s.lesson.sections[sec.id]?.status ?? "pending";
            const isCurrent = i === current && s.timeline.length > 0;
            const done = s.timeline.length > 0 && i < current;
            return (
              <li key={sec.id}>
                <button
                  onClick={() => st === "ready" || (st === "loading" && s.lesson.sections[sec.id].beats.length) ? session.jumpToSection(i) : undefined}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition",
                    isCurrent ? "bg-accent/12 ring-1 ring-accent/35" : "hover:bg-white/[0.04]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                      done ? "bg-accent-2/20 text-accent-2" : isCurrent ? "bg-accent text-white" : "bg-white/[0.07] text-muted",
                    )}
                  >
                    {done ? <Check size={13} /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[14px] leading-snug", isCurrent ? "font-medium text-fg" : "text-fg/85")}>{sec.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-subtle">{sec.goal}</span>
                    {st === "error" && (
                      <span className="mt-1.5 flex items-center gap-2 text-[12px] text-danger">
                        <CircleX size={13} /> {s.lesson.sections[sec.id].error ?? "Failed"}
                      </span>
                    )}
                    {st === "ready" && s.lesson.sections[sec.id]?.partial && (
                      <span className="mt-1.5 flex items-center gap-2 text-[12px] text-warn">
                        Cut short before it was finished.
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            session.retrySection(i);
                          }}
                          className="rounded-md px-1.5 py-0.5 text-accent-strong hover:bg-white/10"
                        >
                          Rewrite
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1 shrink-0">
                    {st === "loading" && <Spinner size={14} />}
                    {st === "pending" && <span className="text-[11px] text-subtle">queued</span>}
                    {st === "error" && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Retry"
                        onClick={(e) => {
                          e.stopPropagation();
                          session.retrySection(i);
                        }}
                        className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-white/10 hover:text-fg"
                      >
                        <RotateCcw size={14} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {s.lesson.research?.status === "done" && !!s.lesson.research.sources.length && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            <Globe size={12} /> Sources the teacher read
          </div>
          <ul className="space-y-1">
            {s.lesson.research.sources.map((src) => (
              <li key={src.url}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-white/[0.04]"
                >
                  <ExternalLink size={12} className="mt-1 shrink-0 text-subtle group-hover:text-accent-strong" />
                  <span className="min-w-0">
                    <span className="block truncate text-fg/90">{src.title}</span>
                    <span className="block truncate text-[11px] text-subtle">{hostOf(src.url)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {s.lesson.research.brief && (
            <details className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2">
              <summary className="cursor-pointer text-[12px] text-muted">What the teacher read before the lesson</summary>
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-subtle">{s.lesson.research.brief}</p>
            </details>
          )}
        </div>
      )}
      {s.lesson.research?.status === "error" && (
        <p className="text-[12px] text-warn">Couldn't research this topic ({s.lesson.research.error}); taught from the model's own knowledge.</p>
      )}
      <p className="text-[12px] leading-relaxed text-subtle">
        Tip: press <b>Space</b> to pause, <b>M</b> to ask by voice, <b>←/→</b> to step. Use the pen tools on the board to take your own notes.
      </p>
    </div>
  );
}
