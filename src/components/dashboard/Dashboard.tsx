"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Atom, BookOpen, Calculator, Dna, MessageSquare, Mic, NotebookPen, PenLine, Sparkles, TriangleAlert } from "lucide-react";
import { fetchStatus, type ServerStatus } from "@/lib/api";
import { DEPTHS, LANGUAGES, LEVELS, newId, type Depth, type Language, type Lesson, type Level } from "@/lib/lesson/types";
import { buildSampleLesson, SAMPLE_CARDS } from "@/lib/lesson/samples";
import { store } from "@/lib/store";
import { useLists } from "@/lib/useLists";
import { timeAgo } from "@/lib/utils";
import { Button, Chip } from "@/components/ui";
import { SourceUpload, type Source } from "@/components/SourceUpload";

const EXAMPLES = [
  "Newton's laws of motion",
  "Ohm's law and circuits",
  "Integration by parts",
  "Photosynthesis",
  "Binary search",
  "Electromagnetic induction",
  "Supply and demand",
  "DNA replication",
  "Quadratic equations",
  "The French Revolution",
];

const SAMPLE_ICON: Record<string, React.ReactNode> = {
  Mathematics: <Calculator size={18} />,
  Physics: <Atom size={18} />,
  Biology: <Dna size={18} />,
};

export function Dashboard() {
  const router = useRouter();
  const { lessons } = useLists();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<Level>("senior");
  const [language, setLanguage] = useState<Language>("english");
  const [depth, setDepth] = useState<Depth>("standard");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetchStatus().then(setStatus);
    inputRef.current?.focus();
  }, []);

  const llm = status?.llm.configured;

  const start = async (t = topic) => {
    const clean = t.trim();
    if (clean.length < 2 || busy) return;
    setBusy(true);
    const now = Date.now();
    const lesson: Lesson = {
      id: newId("l"),
      topic: clean.slice(0, 300),
      level,
      language,
      depth,
      sourceText: sources[0]?.text,
      sourceName: sources[0]?.name,
      status: "new",
      sections: {},
      qa: [],
      chat: [],
      ink: {},
      progress: { index: 0 },
      createdAt: now,
      updatedAt: now,
    };
    await store.saveLesson(lesson);
    router.push(`/learn/${lesson.id}?start=1`);
  };

  const openSample = async (id: string) => {
    const existing = await store.getLesson(id);
    if (!existing) {
      const l = buildSampleLesson(id);
      if (l) await store.saveLesson(l);
    }
    router.push(`/learn/${id}?start=1`);
  };

  return (
    <div className="relative min-h-full">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgb(139_123_255/0.18),transparent_65%)]" />
      <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/70 px-3 py-1 text-[12px] text-muted">
            <Sparkles size={13} className="text-accent-strong" /> Any concept, any subject, explained like your favourite teacher
          </div>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            What do you want to <span className="text-gradient">understand</span> today?
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-[15px] text-muted">
            ConceptAI teaches it step by step on a live whiteboard: speaking, drawing diagrams, solving equations. Interrupt
            anytime with a question, and get exam-ready notes as you learn.
          </p>
        </div>

        {status && !llm && (
          <div className="mx-auto mb-5 flex max-w-3xl items-start gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] text-fg">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <b>No AI provider configured yet.</b> The sample lessons below work right away. To teach any topic, copy{" "}
              <code className="rounded bg-black/30 px-1">.env.example</code> to <code className="rounded bg-black/30 px-1">.env.local</code>, set{" "}
              <code className="rounded bg-black/30 px-1">LLM_PROVIDER</code> and <code className="rounded bg-black/30 px-1">LLM_API_KEY</code> (or point it at a
              local Ollama), and restart the server.
            </div>
          </div>
        )}

        {/* topic composer */}
        <form
          className="mx-auto max-w-3xl rounded-2xl border border-line-strong bg-surface/80 p-3 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.9)] backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="flex items-start gap-2">
            <textarea
              ref={inputRef}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void start();
                }
              }}
              rows={2}
              maxLength={300}
              placeholder="e.g. Explain electromagnetic induction with Faraday's law"
              className="min-h-[56px] flex-1 resize-none bg-transparent px-2 py-2 text-[17px] text-fg placeholder:text-subtle focus:outline-none"
              aria-label="Topic to learn"
            />
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!llm || topic.trim().length < 2} title={llm ? "Start the lesson" : "Configure an AI provider first"}>
              Teach me <ArrowRight size={16} />
            </Button>
          </div>
          <div className="mt-2 space-y-2.5 border-t border-line px-2 pt-3">
            <OptionRow label="Level">
              {LEVELS.map((l) => (
                <Chip key={l.value} active={level === l.value} onClick={() => setLevel(l.value)} title={l.hint}>
                  {l.label}
                </Chip>
              ))}
            </OptionRow>
            <div className="flex flex-wrap gap-x-6 gap-y-2.5">
              <OptionRow label="Language">
                {LANGUAGES.map((l) => (
                  <Chip key={l.value} active={language === l.value} onClick={() => setLanguage(l.value)}>
                    {l.label}
                  </Chip>
                ))}
              </OptionRow>
              <OptionRow label="Length">
                {DEPTHS.map((d) => (
                  <Chip key={d.value} active={depth === d.value} onClick={() => setDepth(d.value)} title={d.hint}>
                    {d.label}
                  </Chip>
                ))}
              </OptionRow>
            </div>
            <OptionRow label="Source">
              <SourceUpload sources={sources} onChange={setSources} label="Teach from my syllabus / PDF / slides" />
            </OptionRow>
          </div>
        </form>

        <div className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => (llm ? void start(ex) : setTopic(ex))}
              className="rounded-full border border-line bg-surface/60 px-3 py-1.5 text-[13px] text-muted transition hover:border-accent/40 hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* samples */}
        <section className="mt-14">
          <SectionTitle title="Try a sample lesson" hint="Works instantly, no API key needed" />
          <div className="grid gap-3 sm:grid-cols-3">
            {SAMPLE_CARDS.map((s) => (
              <button
                key={s.id}
                onClick={() => void openSample(s.id)}
                className="group rounded-2xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface-2"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent-strong">{SAMPLE_ICON[s.subject] ?? <BookOpen size={18} />}</span>
                  <span className="text-[11px] uppercase tracking-wider text-subtle">{s.subject}</span>
                </div>
                <div className="font-semibold leading-snug">{s.title}</div>
                <div className="mt-1 line-clamp-2 text-[13px] text-muted">{s.summary}</div>
                <div className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent-strong opacity-80 group-hover:opacity-100">
                  Start lesson <ArrowRight size={14} />
                </div>
              </button>
            ))}
          </div>
        </section>

        {!!lessons?.filter((l) => !l.sample).length && (
          <section className="mt-12">
            <SectionTitle title="Continue learning" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {lessons
                .filter((l) => !l.sample)
                .slice(0, 6)
                .map((l) => (
                  <Link key={l.id} href={`/learn/${l.id}`} className="rounded-xl border border-line bg-surface p-4 transition hover:border-white/20 hover:bg-surface-2">
                    <div className="truncate font-medium">{l.title}</div>
                    <div className="mt-1 text-[12px] text-subtle">
                      {l.subject ? `${l.subject} · ` : ""}
                      {timeAgo(l.updatedAt)}
                    </div>
                  </Link>
                ))}
            </div>
          </section>
        )}

        <section className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={<PenLine size={18} />} title="Live whiteboard" text="Equations, diagrams, graphs and flowcharts drawn in sync with the explanation." />
          <Feature icon={<Mic size={18} />} title="Talk to your teacher" text="Interrupt by voice: ask why, ask for simpler, ask for another example." />
          <Feature icon={<NotebookPen size={18} />} title="Exam-ready notes" text="Definitions, derivations, worked examples and 2/5/10/15-mark answers." />
          <Feature icon={<MessageSquare size={18} />} title="Practice" text="MCQs, numericals and short answers with step-by-step solutions." />
        </section>
      </div>
    </div>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-[12px] font-medium uppercase tracking-wider text-subtle">{label}</span>
      {children}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <span className="text-[12px] text-subtle">{hint}</span>}
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface/60 p-4">
      <div className="mb-2 text-accent-2">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-[13px] leading-relaxed text-muted">{text}</div>
    </div>
  );
}
