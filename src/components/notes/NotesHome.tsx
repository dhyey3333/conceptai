"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FileText, NotebookPen, Search, TriangleAlert } from "lucide-react";
import { fetchStatus, type ServerStatus } from "@/lib/api";
import { LEVELS, newId, type Level, type Note } from "@/lib/lesson/types";
import { generateNote, settleNote } from "@/lib/notes/generate";
import { shouldResearch, type ResearchPref } from "@/lib/lesson/routing";
import { streamNdjson } from "@/lib/api";
import type { Source as WebSource } from "@/lib/lesson/types";
import { onStoreChange, store } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { Button, Chip, Spinner } from "@/components/ui";
import { SourceUpload, type Source } from "@/components/SourceUpload";

const MARKS = [2, 5, 10, 15];

export function NotesHome() {
  const router = useRouter();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<Level>("college");
  const [marks, setMarks] = useState<number[]>([2, 5, 10, 15]);
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [researchPref, setResearchPref] = useState<ResearchPref>("auto");
  const [progress, setProgress] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void fetchStatus().then(setStatus);
    const load = () =>
      void store
        .allNotes()
        .then((all) => setNotes(all.map(settleNote)))
        .catch(() => setNotes([]));
    load();
    return onStoreChange(load);
  }, []);

  const filtered = useMemo(() => {
    if (!notes) return null;
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    const terms = q.split(/\s+/);
    return notes.filter((n) => {
      const hay = `${n.title}\n${n.topic}\n${n.content}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [notes, query]);

  const llm = status?.llm.configured;
  const researchMode = status?.llm.research ?? "off";
  const canGenerate = llm && marks.length > 0 && (topic.trim().length >= 2 || sources.length > 0);

  const generate = async () => {
    if (!canGenerate || busy) return;
    setBusy(true);
    const now = Date.now();
    const title = topic.trim() || sources[0]?.name.replace(/\.[^.]+$/, "") || "Notes";
    const sourceText = sources.length ? sources.map((s) => `### ${s.name}\n${s.text}`).join("\n\n").slice(0, 60_000) : undefined;
    // Look the topic up first (College/Advanced, or when asked); never block the notes on it.
    let research: { brief: string; sources: WebSource[] } | undefined;
    if (researchMode !== "off" && shouldResearch(researchPref, level) && topic.trim()) {
      setProgress("Researching…");
      try {
        let found = 0;
        await streamNdjson("/api/lesson/research", { topic: title, level, pref: researchPref, tierPref: "auto" }, (ev) => {
          if (ev.type === "source") setProgress(`Researching… ${++found} source${found === 1 ? "" : "s"}`);
          if (ev.type === "done") research = ev.research as typeof research;
        });
      } catch {
        /* write the notes from the model's own knowledge */
      }
      setProgress(null);
    }
    const note: Note = {
      id: newId("n"),
      title: `${title}: Exam Notes`,
      topic: title,
      level,
      marks: [...marks].sort((a, b) => a - b),
      content: "",
      sources: sources.map((s) => ({ name: s.name, chars: s.chars })),
      sourceText,
      research: research?.brief,
      references: research?.sources,
      status: "generating",
      createdAt: now,
      updatedAt: now,
    };
    await store.saveNote(note);
    // Generation runs in the background and keeps going across navigation.
    void generateNote(note, {
      topic: title,
      level,
      marks: note.marks,
      sourceText,
      sourceNames: sources.map((s) => s.name),
      research: research?.brief,
      references: research?.sources,
    });
    router.push(`/notes/${note.id}`);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Exam notes</h1>
        <p className="mt-1 text-[14px] text-muted">
          Comprehensive, exam-ready notes for any topic, or for your own syllabus, PDFs and lecture slides.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* generator */}
        <section className="h-fit rounded-2xl border border-line-strong bg-surface p-5">
          <div className="mb-4 flex items-center gap-2 font-semibold">
            <NotebookPen size={18} className="text-accent-2" /> Generate new notes
          </div>
          {status && !llm && (
            <div className="mb-4 flex gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-[13px]">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" />
              Notes are written by the AI. Configure <code className="mx-1">LLM_PROVIDER</code> and <code className="mx-1">LLM_API_KEY</code> in{" "}
              <code className="mx-1">.env.local</code> to enable this.
            </div>
          )}
          <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-subtle">Topic</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void generate()}
            maxLength={300}
            placeholder="e.g. Thermodynamics: first law, or leave empty to use your syllabus"
            className="h-11 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-[15px] text-fg placeholder:text-subtle focus:border-accent/60 focus:outline-none"
          />
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-subtle">Level</div>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((l) => (
                <Chip key={l.value} active={level === l.value} onClick={() => setLevel(l.value)} title={l.hint}>
                  {l.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-subtle">Answer types</div>
            <div className="flex flex-wrap gap-2">
              {MARKS.map((m) => (
                <Chip key={m} active={marks.includes(m)} onClick={() => setMarks((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}>
                  {m}-mark answers
                </Chip>
              ))}
            </div>
          </div>
          {researchMode !== "off" && (
            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-subtle">
                Research {researchMode === "web" ? "on the web" : "on Wikipedia"} first
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip active={researchPref === "auto"} onClick={() => setResearchPref("auto")} title="For College and Advanced levels">
                  Auto
                </Chip>
                <Chip active={researchPref === "on"} onClick={() => setResearchPref("on")}>
                  Always
                </Chip>
                <Chip active={researchPref === "off"} onClick={() => setResearchPref("off")}>
                  Off
                </Chip>
              </div>
            </div>
          )}
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-subtle">Syllabus, PDFs, slides (optional)</div>
            <SourceUpload sources={sources} onChange={setSources} multiple label="Upload PDF / PPTX / DOCX / TXT" />
            <p className="mt-1.5 text-[12px] text-subtle">Notes will follow your syllabus: every unit it lists, in its order and terminology.</p>
          </div>
          <Button className="mt-5 w-full" variant="primary" size="lg" loading={busy} disabled={!canGenerate} onClick={() => void generate()}>
            {progress ?? "Generate exam notes"}
          </Button>
          <p className="mt-2 text-center text-[12px] text-subtle">Includes definitions, formulas, derivations, diagrams, worked examples and important questions.</p>
        </section>

        {/* library */}
        <section className="min-w-0">
          <div className="relative mb-3">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your notes…"
              aria-label="Search notes"
              className="h-10 w-full rounded-xl border border-line-strong bg-surface pl-9 pr-3 text-[14px] text-fg placeholder:text-subtle focus:border-accent/60 focus:outline-none"
            />
          </div>
          {!filtered ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-[13px] text-muted">
              {query ? "No notes match your search." : "Your saved notes will appear here."}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}`} className="block rounded-xl border border-line bg-surface p-4 transition hover:border-white/20 hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{n.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-subtle">
                        <span>{timeAgo(n.updatedAt)}</span>
                        <span>· {n.marks.map((m) => `${m}M`).join(" ")}</span>
                        {n.sources?.length ? (
                          <span className="inline-flex items-center gap-1">
                            · <FileText size={11} /> {n.sources.length} source{n.sources.length > 1 ? "s" : ""}
                          </span>
                        ) : null}
                        {n.lessonId && <span>· from a lesson</span>}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px]",
                        n.status === "generating" ? "bg-accent/15 text-accent-strong" : n.status === "error" ? "bg-danger/15 text-danger" : "bg-white/[0.06] text-muted",
                      )}
                    >
                      {n.status === "generating" ? "writing…" : n.status === "error" ? "failed" : `${Math.round(n.content.length / 1000)}k chars`}
                    </span>
                  </div>
                  {query && <Snippet text={n.content} query={query} />}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Snippet({ text, query }: { text: string; query: string }) {
  const term = query.trim().split(/\s+/)[0]?.toLowerCase();
  const i = term ? text.toLowerCase().indexOf(term) : -1;
  if (i < 0) return null;
  const start = Math.max(0, i - 60);
  const s = text.slice(start, i + 100).replace(/\s+/g, " ");
  return <div className="mt-2 line-clamp-2 text-[12px] text-muted">…{s}…</div>;
}
