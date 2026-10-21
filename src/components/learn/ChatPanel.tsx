"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, PenLine, X } from "lucide-react";
import type { LessonSession, SessionState } from "@/lib/lesson/session";
import { richHtml } from "@/lib/math/render";
import { updateSettings, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { BoardItemView } from "@/components/board/BoardItemView";
import { Spinner, Switch } from "@/components/ui";

const QUICK = ["Why is this true?", "Where is this used in real life?", "What's a common exam mistake here?"];

export function ChatPanel({
  s,
  session,
  about,
  clearAbout,
  onMic,
  canAsk,
  goToAnswer,
}: {
  s: SessionState;
  session: LessonSession;
  about: { key: string; summary: string } | null;
  clearAbout: () => void;
  onMic: () => void;
  canAsk: boolean;
  goToAnswer: (qaId: string) => void;
}) {
  const settings = useSettings();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = s.lesson.chat;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, chat[chat.length - 1]?.text]);

  useEffect(() => {
    if (about) inputRef.current?.focus();
  }, [about]);

  const send = (q = text) => {
    const question = q.trim();
    if ((!question && !about) || s.asking) return;
    void session.ask(question, about ? "about" : "question", { onBoard: settings.answerOnBoard, about: about ?? undefined });
    setText("");
    clearAbout();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {!chat.length && (
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-[13px] leading-relaxed text-muted">
            <div className="mb-1 font-medium text-fg">Ask anything, anytime</div>
            Questions pause the lesson; the teacher answers on the board and then carries on. Select something on the board with the
            pointer tool to ask about it.
          </div>
        )}
        {chat.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 animate-fade-in">
              {m.about && <div className="mb-1 truncate text-right text-[11px] text-subtle">about: {m.about}</div>}
              <div className="rounded-2xl rounded-br-md bg-accent/20 px-3.5 py-2.5 text-[14px] text-fg">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="mr-4 animate-fade-in">
              <div
                className={cn(
                  "rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-[14px] leading-relaxed",
                  m.error ? "border-danger/30 bg-danger/10 text-fg" : "border-line bg-surface-2 text-fg/95",
                )}
              >
                {m.pending && !m.text ? (
                  <span className="flex items-center gap-2 text-muted">
                    <Spinner size={14} /> Thinking…
                  </span>
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: richHtml(m.text) }} />
                )}
                {!!m.beats?.some((b) => b.draw.length) && (
                  <div className="paper mt-2.5 space-y-3 overflow-x-auto rounded-xl p-3" style={{ background: "#fbfaf7" }}>
                    {m.beats.flatMap((b, bi) =>
                      b.draw.map((it, ii) => (
                        <div key={`${bi}-${ii}`} className="board-page" style={{ fontSize: 14 }}>
                          <div style={{ zoom: 0.6 }}>
                            <BoardItemView item={it} timing={null} width={520} />
                          </div>
                        </div>
                      )),
                    )}
                  </div>
                )}
              </div>
              {m.qaId && !m.pending && !m.error && (
                <button onClick={() => goToAnswer(m.qaId!)} className="mt-1 flex items-center gap-1 text-[12px] text-accent-strong hover:underline">
                  <PenLine size={12} /> Answered on the board
                </button>
              )}
            </div>
          ),
        )}
      </div>

      <div className="mt-3 shrink-0 space-y-2">
        {!chat.length && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                disabled={!canAsk || s.asking}
                onClick={() => send(q)}
                className="rounded-full border border-line-strong px-2.5 py-1 text-[12px] text-muted transition hover:border-white/25 hover:text-fg disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {about && (
          <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[12px]">
            <span className="shrink-0 text-accent-strong">Asking about:</span>
            <span className="truncate text-fg/90">{about.summary}</span>
            <button aria-label="Clear selection" onClick={clearAbout} className="ml-auto text-muted hover:text-fg">
              <X size={13} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface-2 p-1.5 focus-within:border-accent/50">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={1000}
            placeholder={about ? "What would you like to know about it?" : "Ask your teacher…"}
            className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-fg placeholder:text-subtle focus:outline-none"
            aria-label="Question for the teacher"
          />
          <button
            onClick={onMic}
            title="Ask by voice (M)"
            aria-label="Ask by voice"
            className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl transition", s.mic === "listening" ? "bg-danger text-white" : "text-muted hover:bg-white/10 hover:text-fg")}
          >
            <Mic size={17} />
          </button>
          <button
            onClick={() => send()}
            disabled={(!text.trim() && !about) || s.asking || !canAsk}
            aria-label="Send question"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:brightness-110 disabled:opacity-35"
          >
            {s.asking ? <Spinner size={15} className="text-white" /> : <ArrowUp size={17} />}
          </button>
        </div>
        <div className="flex items-center justify-between px-1">
          <Switch checked={settings.answerOnBoard} onChange={(v) => updateSettings({ answerOnBoard: v })} label="Teacher answers on the board" />
          {!canAsk && <span className="text-[11px] text-warn">Needs an AI provider</span>}
        </div>
      </div>
    </div>
  );
}
