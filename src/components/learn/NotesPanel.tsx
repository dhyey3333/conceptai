"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, NotebookPen } from "lucide-react";
import type { LessonSession, SessionState } from "@/lib/lesson/session";
import type { Note } from "@/lib/lesson/types";
import { settleNote, useLiveNote, useNoteRecheck } from "@/lib/notes/generate";
import { store } from "@/lib/store";
import { Button, Spinner } from "@/components/ui";
import { MarkdownView } from "@/components/notes/MarkdownView";

/** Exam notes for this lesson, filling in live while the lesson plays. */
export function NotesPanel({ s, session, canAsk }: { s: SessionState; session: LessonSession; canAsk: boolean }) {
  const noteId = s.lesson.noteId;
  const live = useLiveNote(noteId);
  const [saved, setSaved] = useState<Note | null>(null);
  useNoteRecheck(noteId);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!noteId) return;
    void store.getNote(noteId).then((n) => setSaved(n ? settleNote(n) : null));
  }, [noteId, live?.status, live?.version]);

  const content = live?.content ?? saved?.content ?? "";
  const status = live?.status ?? saved?.status;

  if (!noteId) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent-2/15 text-accent-2">
          <NotebookPen size={22} />
        </div>
        <div className="font-semibold">Exam-ready notes</div>
        <p className="mt-1 max-w-xs text-[13px] text-muted">
          Definitions, formulas, derivations, diagrams, worked examples, and model answers for 2, 5, 10 and 15 marks.
        </p>
        <Button
          className="mt-4"
          variant="primary"
          loading={starting}
          disabled={!canAsk || !s.lesson.outline}
          onClick={async () => {
            setStarting(true);
            await session.startNotes();
            setStarting(false);
          }}
        >
          Generate notes for this lesson
        </Button>
        {!canAsk && <p className="mt-3 text-[12px] text-warn">Needs an AI provider (see .env.example).</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          {status === "generating" ? (
            <>
              <Spinner size={14} /> {live?.checking ? "Fact-checking the notes…" : "Writing notes as you learn…"}
              {live?.notice && !live.checking && <span className="text-[12px] text-subtle">{live.notice}</span>}
            </>
          ) : status === "error" ? (
            <span className="text-danger">{live?.error ?? saved?.error ?? "Generation failed"}</span>
          ) : saved?.checked === false ? (
            <span title="Written while the fact-checker was unavailable; checked automatically once it is back.">
              Notes ready · <span className="text-warn">not fact-checked yet</span>
            </span>
          ) : (
            "Notes ready"
          )}
        </div>
        <Link href={`/notes/${noteId}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-accent-strong hover:bg-white/5">
          Open editor <ExternalLink size={12} />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-[#fbfaf7] px-4 py-4 shadow-inner">
        {content ? (
          <MarkdownView content={content} streaming={status === "generating"} className="text-[13.5px]" />
        ) : (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#8a8170]">
            <Spinner size={14} /> Starting…
          </div>
        )}
      </div>
    </div>
  );
}
