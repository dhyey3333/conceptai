"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, CircleQuestionMark, ListTree, Menu, MessageSquare, Mic, NotebookPen, Play, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import { fetchStatus, type ServerStatus } from "@/lib/api";
import { summarizeItem } from "@/lib/board/summary";
import { LessonSession, type SessionState } from "@/lib/lesson/session";
import { buildSampleLesson } from "@/lib/lesson/samples";
import { pageItems } from "@/lib/lesson/timeline";
import type { Lesson } from "@/lib/lesson/types";
import { useSettings } from "@/lib/settings";
import { store } from "@/lib/store";
import { cn, hostOf, isTyping, modelLabel } from "@/lib/utils";
import { startListening, type ListenSession } from "@/lib/voice/listener";
import { Whiteboard, type BoardEntry } from "@/components/board/Whiteboard";
import { useShell } from "@/components/shell/AppShell";
import { Button, Spinner, Tabs } from "@/components/ui";
import { ChatPanel } from "./ChatPanel";
import { NotesPanel } from "./NotesPanel";
import { OutlinePanel } from "./OutlinePanel";
import { PlayerBar } from "./PlayerBar";
import { PracticePanel } from "./PracticePanel";
import { VideoButton } from "./VideoButton";
import { VoiceSettings } from "./VoiceSettings";

type Boot = { lesson: Lesson; status: ServerStatus } | "missing" | null;

export function Workspace({ id, autostart }: { id: string; autostart: boolean }) {
  const [boot, setBoot] = useState<Boot>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      let lesson = await store.getLesson(id).catch(() => undefined);
      if (!lesson && id.startsWith("sample-")) {
        lesson = buildSampleLesson(id) ?? undefined;
        if (lesson) await store.saveLesson(lesson);
      }
      const status = await fetchStatus();
      if (alive) setBoot(lesson ? { lesson, status } : "missing");
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (boot === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  if (boot === "missing")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-lg font-semibold">Lesson not found</div>
        <p className="text-sm text-muted">It may have been deleted, or saved in a different browser.</p>
        <Link href="/" className="text-sm text-accent-strong hover:underline">
          Start a new lesson
        </Link>
      </div>
    );
  return <LessonView key={id} lesson={boot.lesson} status={boot.status} autostart={autostart} />;
}

const noopSubscribe = () => () => {};

function useSession(session: LessonSession | null): SessionState | null {
  return useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : () => null,
    () => null,
  );
}

/** Items on a board page, with animation timing for the beat being taught right now. */
function boardEntries(s: SessionState, sectionId: string): BoardEntry[] {
  const upto = s.beatStarted ? s.index : s.index - 1;
  let j = 0;
  return pageItems(s.timeline, sectionId, upto).map((pi) => {
    const isCurrent = s.beatStarted && pi.beatIndex === s.index;
    const beatKey = s.timeline[pi.beatIndex].key;
    const timing = isCurrent && s.timings ? (s.timings[j++] ?? null) : null;
    return { key: `${pi.key}~${s.replays[beatKey] ?? 0}`, item: pi.item, timing };
  });
}

type Tab = "outline" | "ask" | "practice" | "notes";

function LessonView({ lesson, status, autostart }: { lesson: Lesson; status: ServerStatus; autostart: boolean }) {
  const router = useRouter();
  const settings = useSettings();
  const { openSidebar } = useShell();
  const [session, setSession] = useState<LessonSession | null>(null);
  const s = useSession(session);
  const [tab, setTab] = useState<Tab>("outline");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [about, setAbout] = useState<{ key: string; summary: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const listenRef = useRef<ListenSession | null>(null);
  const llm = status.llm.configured;

  // Created in an effect (not during render) so React's dev double-mount gets a clean session.
  useEffect(() => {
    const sess = new LessonSession(lesson, {
      llm,
      llmProvider: status.llm.provider,
      sequential: status.llm.sequential,
      tts: status.tts.configured,
      settings,
    });
    setSession(sess);
    void sess.generate();
    if (autostart) {
      sess.play();
      router.replace(`/learn/${lesson.id}`, { scroll: false });
    }
    return () => {
      listenRef.current?.cancel();
      sess.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  useEffect(() => {
    session?.updateEnv({ settings });
  }, [session, settings]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleMic = useCallback(() => {
    if (!session) return;
    if (listenRef.current) {
      listenRef.current.stop();
      return;
    }
    let heard: string | null = null;
    session.startListening();
    listenRef.current = startListening({
      language: session.getSnapshot().lesson.language,
      useServer: status.stt.configured,
      hint: session.getSnapshot().lesson.outline?.title ?? session.getSnapshot().lesson.topic,
      onInterim: (t) => session.setInterim(t),
      onFinal: (t) => (heard = t),
      onError: (m) => setToast(m),
      onNotice: (m) => setToast(m),
      onEnd: () => {
        listenRef.current = null;
        if (heard && !llm) {
          // Commands still work without an AI provider.
          session.handleUtterance(heard, false);
          session.stopListening(null);
          return;
        }
        session.stopListening(heard);
        if (heard && !/^(pause|stop|wait|resume|continue|play|next|skip|repeat)/i.test(heard.trim())) setTab("ask");
      },
    });
  }, [session, status.stt.configured, llm]);

  // Keyboard: Space play/pause, M mic, arrows step.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        session.toggle();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMic();
      } else if (e.key === "ArrowRight") session.next();
      else if (e.key === "ArrowLeft") session.prev();
      else if (e.key === "Escape") setSelectedKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, toggleMic]);

  const sectionId = s && session ? session.currentSectionId(s) : undefined;
  const entries = useMemo(() => (s && sectionId ? boardEntries(s, sectionId) : []), [s, sectionId]);

  if (!s || !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  const l = s.lesson;
  const sections = l.outline?.sections ?? [];
  const pageIndex = sections.findIndex((x) => x.id === sectionId);
  const liveSection = s.timeline[Math.min(s.index, s.timeline.length - 1)]?.sectionId;
  const viewingOther = !!s.viewSection && s.viewSection !== liveSection;
  const generatingIdx = sections.findIndex((x) => l.sections[x.id]?.status === "loading");
  const checkingIdx = sections.findIndex((x) => l.sections[x.id]?.phase === "checking");
  const readyParts = sections.filter((x) => l.sections[x.id]?.status === "ready");
  const allChecked = readyParts.length > 0 && readyParts.every((x) => l.sections[x.id]?.checked);
  // Taught while the checker was unavailable (e.g. by the local stand-in); checked automatically later.
  const uncheckedParts = readyParts.filter((x) => l.sections[x.id]?.checked === false && !l.sections[x.id]?.phase).length;
  const totalFixes = readyParts.reduce((n, x) => n + (l.sections[x.id]?.fixes ?? 0), 0);
  const selected = entries.find((e) => e.key === selectedKey);
  const researching = l.research?.status === "running";

  const askAboutSelection = () => {
    if (!selected) return;
    setAbout({ key: selected.key, summary: summarizeItem(selected.item).slice(0, 600) });
    setSelectedKey(null);
    setTab("ask");
  };

  const goToAnswer = (qaId: string) => {
    const t = s.timeline.find((x) => x.qa?.id === qaId);
    if (t) session.viewPage(t.sectionId);
  };

  const pageHasContent = (sid: string) => s.timeline.some((t, i) => t.sectionId === sid && i <= (s.beatStarted ? s.index : s.index - 1));

  const overlay = (
    <>
      {/* captions */}
      {settings.captions && s.caption && (s.phase === "playing" || s.phase === "paused") && !viewingOther && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-6">
          <div className="max-w-3xl rounded-xl bg-black/70 px-4 py-2 text-center text-[15px] leading-snug text-white shadow-lg backdrop-blur">{s.caption}</div>
        </div>
      )}
      {/* listening */}
      {s.mic === "listening" && (
        <div className="absolute inset-x-0 bottom-20 z-20 flex justify-center px-6">
          <div className="flex max-w-xl animate-fade-in items-center gap-3 rounded-2xl border border-danger/40 bg-surface/95 px-4 py-3 shadow-2xl backdrop-blur">
            <span className="relative grid h-9 w-9 place-items-center rounded-full bg-danger text-white">
              <span className="absolute inset-0 animate-ping rounded-full bg-danger/50" />
              <Mic size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">Listening, ask your question…</div>
              <div className="truncate text-[13px] text-muted">{s.interim || "Try: “why is it squared?” or “explain simpler”"}</div>
            </div>
            <Button size="sm" variant="secondary" onClick={toggleMic}>
              Done
            </Button>
          </div>
        </div>
      )}
      {/* selection action */}
      {selected && (
        <div className="absolute bottom-4 right-4 z-20 flex animate-fade-in items-center gap-2">
          <Button size="sm" variant="primary" onClick={askAboutSelection}>
            <CircleQuestionMark size={14} /> Ask about this
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setSelectedKey(null)} aria-label="Clear selection">
            <X size={14} />
          </Button>
        </div>
      )}
      {/* start */}
      {s.phase === "idle" && s.timeline.length > 0 && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/25 backdrop-blur-[1px]">
          <button onClick={() => session.play()} className="group flex flex-col items-center gap-3">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-b from-accent-strong to-accent text-white shadow-[0_10px_40px_-8px_rgb(139_123_255/0.9)] transition group-hover:scale-105">
              <Play size={32} className="translate-x-0.5" />
            </span>
            <span className="text-sm font-medium text-fg">Start the lesson</span>
          </button>
        </div>
      )}
    </>
  );

  const empty =
    l.status === "error" ? (
      <div className="pointer-events-auto max-w-md rounded-2xl border border-line-strong bg-surface/95 p-6 text-center shadow-2xl">
        <TriangleAlert className="mx-auto mb-2 text-warn" size={26} />
        {l.error === "llm_not_configured" ? (
          <>
            <div className="font-semibold">An AI provider is needed for new topics</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Copy <code>.env.example</code> to <code>.env.local</code>, set <code>LLM_PROVIDER</code> and <code>LLM_API_KEY</code> (or use local Ollama),
              then restart. Meanwhile, the sample lessons on the dashboard work offline.
            </p>
            <Link href="/" className="mt-4 inline-block text-sm text-accent-strong hover:underline">
              Back to dashboard
            </Link>
          </>
        ) : (
          <>
            <div className="font-semibold">Couldn&apos;t plan this lesson</div>
            <p className="mt-1.5 text-[13px] text-muted">{l.error}</p>
            <Button className="mt-4" onClick={() => session.retryOutline()}>
              <RotateCcw size={14} /> Try again
            </Button>
          </>
        )}
      </div>
    ) : s.timeline.length === 0 ? (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
          <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/20 text-accent-strong">
            <Sparkles size={24} />
          </span>
        </div>
        <div>
          <div className="text-lg font-semibold text-fg">
            {researching ? "Researching the topic…" : l.outline ? "Preparing the first part…" : "Planning your lesson…"}
          </div>
          <div className="mt-1 text-sm text-muted">{l.outline ? `“${l.outline.sections[0]?.title}”` : `Topic: ${l.topic}`}</div>
        </div>
        {researching && (
          <div className="max-w-md space-y-2 text-[12px]">
            {l.research?.queries.map((q, i) => (
              <div key={i} className="animate-fade-in text-muted">
                Searching “{q}”
              </div>
            ))}
            <div className="flex flex-wrap justify-center gap-1.5">
              {l.research?.sources.map((src) => (
                <span key={src.url} className="animate-fade-in rounded-full border border-line-strong bg-surface/80 px-2 py-0.5 text-subtle">
                  {hostOf(src.url)}
                </span>
              ))}
            </div>
          </div>
        )}
        {sections.length > 0 && l.sections[sections[0].id]?.status === "error" && (
          <Button className="pointer-events-auto" onClick={() => session.retrySection(0)}>
            <RotateCcw size={14} /> Retry: {l.sections[sections[0].id].error}
          </Button>
        )}
      </div>
    ) : null;

  const corner = sections.length ? (
    <div className="flex items-center gap-1 text-[12px]">
      <button
        aria-label="Previous board page"
        disabled={pageIndex <= 0 || !pageHasContent(sections[pageIndex - 1]?.id)}
        onClick={() => session.viewPage(sections[pageIndex - 1].id)}
        className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg disabled:opacity-30"
      >
        <ChevronLeft size={15} />
      </button>
      <span className="max-w-[220px] truncate px-1 text-muted" title={sections[pageIndex]?.title}>
        Board {pageIndex + 1}/{sections.length} · <span className="text-fg">{sections[pageIndex]?.title}</span>
      </span>
      <button
        aria-label="Next board page"
        disabled={pageIndex >= sections.length - 1 || !pageHasContent(sections[pageIndex + 1]?.id)}
        onClick={() => session.viewPage(sections[pageIndex + 1].id)}
        className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg disabled:opacity-30"
      >
        <ChevronRight size={15} />
      </button>
      {viewingOther && (
        <button onClick={() => session.viewPage(null)} className="ml-1 rounded-lg bg-accent/20 px-2 py-1 text-accent-strong hover:bg-accent/30">
          Back to live
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className="flex min-h-full flex-col xl:h-full">
      {/* header */}
      <header className="no-print flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <button aria-label="Open menu" onClick={openSidebar} className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg lg:grid">
          <Menu size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {l.outline?.subject && <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-muted">{l.outline.subject}</span>}
            {l.sample && <span className="rounded-md bg-accent-2/15 px-1.5 py-0.5 text-[11px] text-accent-2">Sample</span>}
            <h1 className="truncate text-[15px] font-semibold">{l.outline?.title ?? l.topic}</h1>
            {l.model && (
              <span className="hidden shrink-0 rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] text-muted sm:inline" title="Model teaching this lesson">
                {modelLabel(l.model)}
              </span>
            )}
            {uncheckedParts > 0 && checkingIdx < 0 && (
              <span
                className="hidden shrink-0 rounded-md bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn sm:inline"
                title="These parts were taught while the fact-checker was unavailable. They are checked automatically once it is back, and any correction is applied (and said out loud if you already heard that part)."
              >
                {uncheckedParts} part{uncheckedParts === 1 ? "" : "s"} not fact-checked yet
              </span>
            )}
            {allChecked && (
              <span
                className="hidden shrink-0 rounded-md bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok sm:inline"
                title="Every part was reviewed by a second, examiner-style pass; corrections replace the original, and anything you already heard is corrected out loud"
              >
                Fact-checked{totalFixes ? ` · ${totalFixes} fix${totalFixes === 1 ? "" : "es"}` : ""}
              </span>
            )}
            {l.research?.status === "done" && (
              <button
                onClick={() => setTab("outline")}
                className="hidden shrink-0 rounded-md bg-accent-2/15 px-1.5 py-0.5 text-[11px] text-accent-2 hover:bg-accent-2/25 sm:inline"
                title="Taught from sources found before the lesson; see them in the Outline tab"
              >
                Researched · {l.research.sources.length} source{l.research.sources.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-subtle">
            {researching ? (
              <>
                <Spinner size={12} /> Researching{l.research?.queries.length ? `: “${l.research.queries[l.research.queries.length - 1]}”` : "…"}
              </>
            ) : l.status === "outlining" ? (
              <>
                <Spinner size={12} /> Planning the lesson…
              </>
            ) : generatingIdx >= 0 || checkingIdx >= 0 ? (
              <>
                <Spinner size={12} /> {generatingIdx >= 0 ? "Writing" : "Fact-checking"} part {(generatingIdx >= 0 ? generatingIdx : checkingIdx) + 1} of{" "}
                {sections.length}
                {s.timeline.length ? " while you learn" : ""}
              </>
            ) : s.phase === "buffering" && s.asking ? (
              <>
                <Spinner size={12} /> Thinking about your question…
              </>
            ) : sections.length ? (
              <>
                {s.timeline.length} steps · {readyParts.length < sections.length ? `${readyParts.length} of ${sections.length} parts ready, the rest are written as you go` : `${sections.length} parts`}
                {s.phase === "ended" ? " · finished" : ""}
              </>
            ) : null}
          </div>
        </div>
        <VideoButton lesson={l} ready={sections.length > 0 && readyParts.length === sections.length && generatingIdx < 0 && checkingIdx < 0} />
        <VoiceSettings ttsAvailable={status.tts.configured} sttAvailable={status.stt.configured} />
      </header>

      {s.notice && (
        <div className="no-print mx-3 mt-3 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[13px]">
          <TriangleAlert size={15} className="shrink-0 text-warn" />
          <span className="flex-1">{s.notice}</span>
          <button aria-label="Dismiss" onClick={() => session.dismissNotice()} className="text-muted hover:text-fg">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
        <div className="flex h-[78vh] min-w-0 flex-1 flex-col gap-3 xl:h-auto xl:min-h-0">
          <div className="min-h-0 flex-1">
            <Whiteboard
              entries={entries}
              paused={s.phase !== "playing"}
              pointedId={viewingOther ? null : s.pointed}
              ink={(sectionId && l.ink[sectionId]) || []}
              onInkChange={(strokes) => sectionId && session.setInk(sectionId, strokes)}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              pageKey={sectionId ?? "none"}
              empty={empty}
              overlay={overlay}
              corner={corner}
            />
          </div>
          <PlayerBar s={s} session={session} onMic={toggleMic} canAsk={llm && !!l.outline} />
        </div>

        <aside className="no-print flex h-[70vh] w-full shrink-0 flex-col rounded-2xl border border-line bg-surface p-3 xl:h-auto xl:w-[400px] 2xl:w-[440px]">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: "outline", label: "Outline", icon: <ListTree size={14} /> },
              {
                value: "ask",
                label: "Ask",
                icon: <MessageSquare size={14} />,
                badge: s.asking ? <Spinner size={11} /> : null,
              },
              { value: "practice", label: "Practice", icon: <Sparkles size={14} /> },
              { value: "notes", label: "Notes", icon: <NotebookPen size={14} /> },
            ]}
          />
          <div className={cn("mt-3 min-h-0 flex-1", tab === "ask" || tab === "notes" ? "flex flex-col" : "overflow-y-auto pr-1")}>
            {tab === "outline" && <OutlinePanel s={s} session={session} />}
            {tab === "ask" && (
              <ChatPanel
                s={s}
                session={session}
                about={about}
                clearAbout={() => setAbout(null)}
                onMic={toggleMic}
                canAsk={llm && !!l.outline}
                goToAnswer={goToAnswer}
              />
            )}
            {tab === "practice" && <PracticePanel s={s} session={session} canAsk={llm} />}
            {tab === "notes" && <NotesPanel s={s} session={session} canAsk={llm} />}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-in rounded-xl border border-line-strong bg-surface-3 px-4 py-2.5 text-[13px] shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
