"use client";

import { useState } from "react";
import { Check, CircleX, RotateCcw, Sparkles } from "lucide-react";
import type { LessonSession, SessionState } from "@/lib/lesson/session";
import type { McqQuestion, NumericalQuestion, ShortQuestion } from "@/lib/quiz/schema";
import { richHtml } from "@/lib/math/render";
import { cn } from "@/lib/utils";
import { Button, Spinner } from "@/components/ui";

const Rich = ({ text, className }: { text: string; className?: string }) => (
  <span className={className} dangerouslySetInnerHTML={{ __html: richHtml(text) }} />
);

export function PracticePanel({ s, session, canAsk }: { s: SessionState; session: LessonSession; canAsk: boolean }) {
  const quiz = s.lesson.quiz;
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const record = (id: string, ok: boolean) => setAnswers((a) => (id in a ? a : { ...a, [id]: ok }));

  if (!quiz) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent-strong">
          <Sparkles size={22} />
        </div>
        <div className="font-semibold">Practice what you learned</div>
        <p className="mt-1 max-w-xs text-[13px] text-muted">MCQs, numerical problems and short-answer questions with step-by-step solutions, made from this lesson.</p>
        <Button className="mt-4" variant="primary" loading={s.quizLoading} disabled={!canAsk || !s.lesson.outline} onClick={() => void session.generateQuiz()}>
          Generate practice questions
        </Button>
        {s.quizLoading && <p className="mt-2 text-[12px] text-subtle">Writing and checking questions…</p>}
        {s.quizError && <p className="mt-3 text-[13px] text-danger">{s.quizError}</p>}
        {!canAsk && <p className="mt-3 text-[12px] text-warn">Needs an AI provider (see .env.example).</p>}
      </div>
    );
  }

  const total = quiz.mcq.length + quiz.numerical.length;
  const correct = Object.values(answers).filter(Boolean).length;
  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-muted">
          Score:{" "}
          <b className="text-fg">
            {correct}/{total}
          </b>{" "}
          answered correctly
        </div>
        <Button
          size="sm"
          variant="ghost"
          loading={s.quizLoading}
          onClick={() => {
            setAnswers({});
            void session.generateQuiz();
          }}
        >
          <RotateCcw size={13} /> New set
        </Button>
      </div>
      {quiz.mcq.map((q, i) => (
        <Mcq key={`m${i}-${q.q}`} q={q} n={i + 1} onAnswer={(ok) => record(`m${i}`, ok)} />
      ))}
      {quiz.numerical.map((q, i) => (
        <Numerical key={`n${i}-${q.q}`} q={q} n={quiz.mcq.length + i + 1} onAnswer={(ok) => record(`n${i}`, ok)} />
      ))}
      {quiz.short.map((q, i) => (
        <Short key={`s${i}-${q.q}`} q={q} n={total + i + 1} />
      ))}
      {s.quizError && <p className="text-[13px] text-danger">{s.quizError}</p>}
    </div>
  );
}

function Card({ n, kind, children }: { n: number; kind: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        Q{n} · {kind}
      </div>
      {children}
    </div>
  );
}

function Mcq({ q, n, onAnswer }: { q: McqQuestion; n: number; onAnswer: (ok: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <Card n={n} kind="MCQ">
      <Rich text={q.q} className="block text-[14px] leading-relaxed" />
      <div className="mt-3 space-y-1.5">
        {q.options.map((op, i) => {
          const isAnswer = i === q.answer;
          const show = picked !== null;
          return (
            <button
              key={i}
              disabled={show}
              onClick={() => {
                setPicked(i);
                onAnswer(i === q.answer);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition",
                !show && "border-line-strong hover:border-accent/50 hover:bg-white/[0.03]",
                show && isAnswer && "border-ok/50 bg-ok/10",
                show && picked === i && !isAnswer && "border-danger/50 bg-danger/10",
                show && picked !== i && !isAnswer && "border-line opacity-60",
              )}
            >
              <span className="font-semibold text-subtle">{String.fromCharCode(65 + i)}</span>
              <Rich text={op} className="flex-1" />
              {show && isAnswer && <Check size={15} className="shrink-0 text-ok" />}
              {show && picked === i && !isAnswer && <CircleX size={15} className="shrink-0 text-danger" />}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="mt-3 rounded-lg bg-black/20 p-2.5 text-[13px] leading-relaxed text-fg/90">
          <b className={picked === q.answer ? "text-ok" : "text-danger"}>{picked === q.answer ? "Correct. " : "Not quite. "}</b>
          <Rich text={q.explanation} />
        </div>
      )}
    </Card>
  );
}

function Numerical({ q, n, onAnswer }: { q: NumericalQuestion; n: number; onAnswer: (ok: boolean) => void }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<null | boolean>(null);
  const [showSteps, setShowSteps] = useState(false);
  const check = () => {
    const v = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(v)) return;
    // Relative tolerance (default 2%), with an absolute floor for answers near zero.
    const tol = Math.max(Math.abs(q.answer) * (q.tolerance ?? 0.02), 1e-6);
    const ok = Math.abs(v - q.answer) <= tol;
    setResult(ok);
    onAnswer(ok);
    if (!ok) setShowSteps(true);
  };
  return (
    <Card n={n} kind="Numerical">
      <Rich text={q.q} className="block text-[14px] leading-relaxed" />
      <div className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && check()}
          inputMode="decimal"
          placeholder="Your answer"
          aria-label="Your numerical answer"
          className="h-9 w-36 rounded-lg border border-line-strong bg-surface-3 px-2.5 text-[14px] text-fg focus:border-accent/60 focus:outline-none"
        />
        {q.unit && <span className="text-[13px] text-muted">{q.unit}</span>}
        <Button size="sm" onClick={check} disabled={!value.trim()}>
          Check
        </Button>
        {result !== null && (result ? <Check size={18} className="text-ok" /> : <CircleX size={18} className="text-danger" />)}
      </div>
      <button onClick={() => setShowSteps((v) => !v)} className="mt-2 text-[12px] text-accent-strong hover:underline">
        {showSteps ? "Hide solution" : "Show step-by-step solution"}
      </button>
      {showSteps && (
        <ol className="mt-2 list-decimal space-y-1 rounded-lg bg-black/20 py-2.5 pl-7 pr-3 text-[13px] leading-relaxed">
          {q.solution.map((st, i) => (
            <li key={i}>
              <Rich text={st} />
            </li>
          ))}
          <li className="list-none font-semibold text-ok">
            Answer: {q.answer} {q.unit}
          </li>
        </ol>
      )}
    </Card>
  );
}

function Short({ q, n }: { q: ShortQuestion; n: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Card n={n} kind={`Short answer${q.marks ? ` · ${q.marks} marks` : ""}`}>
      <Rich text={q.q} className="block text-[14px] leading-relaxed" />
      <button onClick={() => setOpen((v) => !v)} className="mt-2 text-[12px] text-accent-strong hover:underline">
        {open ? "Hide model answer" : "Show model answer"}
      </button>
      {open && <Rich text={q.answer} className="mt-2 block rounded-lg bg-black/20 p-2.5 text-[13px] leading-relaxed" />}
    </Card>
  );
}
