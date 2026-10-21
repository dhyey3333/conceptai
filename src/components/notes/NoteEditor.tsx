"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bold, Check, Columns2, Copy, Download, Eye, FileDown, Heading2, List, Pencil, Printer, RotateCcw, Sigma, Square, Trash } from "lucide-react";
import type { Note } from "@/lib/lesson/types";
import { cancelNote, generateNote, isGeneratingNote, settleNote, useLiveNote } from "@/lib/notes/generate";
import { store } from "@/lib/store";
import { cn, downloadText, slugify } from "@/lib/utils";
import { Button, Spinner } from "@/components/ui";
import { MarkdownView } from "./MarkdownView";

type Mode = "edit" | "split" | "preview";

export function NoteEditor({ id }: { id: string }) {
  const router = useRouter();
  const live = useLiveNote(id);
  const [note, setNote] = useState<Note | null | "missing">(null);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("preview");
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty">("saved");
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generating = live?.status === "generating" || (note !== "missing" && note?.status === "generating" && isGeneratingNote(id));

  // Load; reload when a background generation finishes.
  useEffect(() => {
    void store.getNote(id).then((stored) => {
      if (!stored) return setNote("missing");
      const n = settleNote(stored);
      if (n !== stored) void store.saveNote(n, true);
      setNote(n);
      setDraft(n.content);
      setTitle(n.title);
    });
  }, [id, live?.status]);

  const persist = useCallback(
    async (patch: Partial<Note>) => {
      if (!note || note === "missing") return;
      setSaved("saving");
      const next: Note = { ...note, ...patch, updatedAt: Date.now() };
      await store.saveNote(next);
      setNote(next);
      setSaved("saved");
    },
    [note],
  );

  const onEdit = (value: string) => {
    setDraft(value);
    setSaved("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist({ content: value, status: "ready" }), 800);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  if (note === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  if (note === "missing")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-lg font-semibold">Notes not found</div>
        <Link href="/notes" className="text-sm text-accent-strong hover:underline">
          Back to notes
        </Link>
      </div>
    );

  const content = generating ? (live?.content ?? draft) : draft;
  const effectiveMode: Mode = generating ? "preview" : mode;

  const wrap = (before: string, after = before, placeholder = "text") => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const sel = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    onEdit(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  };
  const linePrefix = (prefix: string) => {
    const el = area.current;
    if (!el) return;
    const a = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    onEdit(el.value.slice(0, a) + prefix + el.value.slice(a));
  };

  const exportPdf = () => {
    setMode("preview");
    // Let the preview render, then use the browser's print-to-PDF (keeps maths and diagrams crisp).
    setTimeout(() => window.print(), 350);
  };

  const regenerate = async () => {
    if (!window.confirm("Regenerate these notes? Your edits will be replaced.")) return;
    void generateNote(note, {
      topic: note.topic,
      level: note.level,
      marks: note.marks,
      outline: note.outline,
      sourceText: note.sourceText,
      sourceNames: note.sources?.map((s) => s.name),
    });
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    cancelNote(note.id);
    await store.deleteNote(note.id);
    router.push("/notes");
  };

  return (
    <div className="print-flow flex min-h-full flex-col lg:h-full">
      <header className="no-print flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Link href={note.lessonId ? `/learn/${note.lessonId}` : "/notes"} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg" title={note.lessonId ? "Back to the lesson" : "All notes"}>
          <ArrowLeft size={17} />
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== note.title && void persist({ title: title.trim().slice(0, 140) })}
          aria-label="Notes title"
          className="min-w-[180px] flex-1 truncate rounded-lg bg-transparent px-2 py-1 text-[15px] font-semibold text-fg hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none"
        />
        <span className="hidden text-[12px] text-subtle sm:inline">
          {generating ? (
            <span className="flex items-center gap-1.5 text-accent-strong">
              <Spinner size={12} /> Writing… {Math.round((live?.content.length ?? 0) / 100) / 10}k
            </span>
          ) : saved === "saved" ? (
            <span className="flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          ) : saved === "saving" ? (
            "Saving…"
          ) : (
            "Edited"
          )}
        </span>
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          {(
            [
              ["edit", <Pencil key="e" size={14} />, "Edit"],
              ["split", <Columns2 key="s" size={14} />, "Split"],
              ["preview", <Eye key="p" size={14} />, "Preview"],
            ] as const
          ).map(([m, icon, label]) => (
            <button
              key={m}
              disabled={generating}
              onClick={() => setMode(m)}
              className={cn("flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] disabled:opacity-40", effectiveMode === m ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
            >
              {icon}
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>
        {generating ? (
          <Button size="sm" variant="secondary" onClick={() => cancelNote(note.id)}>
            <Square size={12} /> Stop
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => downloadText(`${slugify(note.title)}.md`, draft)} title="Download Markdown">
              <Download size={14} /> <span className="hidden md:inline">.md</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={exportPdf} title="Export as PDF (print → Save as PDF)">
              <FileDown size={14} /> <span className="hidden md:inline">PDF</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Copy Markdown"
              onClick={async () => {
                await navigator.clipboard.writeText(draft);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
            <Button size="sm" variant="ghost" title="Print" onClick={exportPdf}>
              <Printer size={14} />
            </Button>
            <Button size="sm" variant="ghost" title="Regenerate" onClick={() => void regenerate()}>
              <RotateCcw size={14} />
            </Button>
            <Button size="sm" variant="ghost" title="Delete" onClick={() => void remove()} className="hover:text-danger">
              <Trash size={14} />
            </Button>
          </>
        )}
      </header>

      {(live?.error ?? note.error) && !generating && (
        <div className="no-print mx-4 mt-3 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[13px]">{live?.error ?? note.error}</div>
      )}

      <div className={cn("print-flow min-h-0 flex-1 gap-4 p-4", effectiveMode === "split" ? "grid lg:grid-cols-2" : "flex")}>
        {effectiveMode !== "preview" && (
          <div className="no-print flex min-h-[60vh] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface lg:min-h-0">
            <div className="flex items-center gap-0.5 border-b border-line px-2 py-1.5">
              <ToolBtn title="Bold" onClick={() => wrap("**")}>
                <Bold size={14} />
              </ToolBtn>
              <ToolBtn title="Heading" onClick={() => linePrefix("## ")}>
                <Heading2 size={14} />
              </ToolBtn>
              <ToolBtn title="Bullet" onClick={() => linePrefix("- ")}>
                <List size={14} />
              </ToolBtn>
              <ToolBtn title="Inline maths" onClick={() => wrap("$", "$", "x^2")}>
                <Sigma size={14} />
              </ToolBtn>
              <ToolBtn title="Display maths" onClick={() => wrap("\n$$\n", "\n$$\n", "E = mc^2")}>
                <span className="text-[11px] font-semibold">$$</span>
              </ToolBtn>
              <span className="ml-auto text-[11px] text-subtle">Markdown · KaTeX · ```mermaid</span>
            </div>
            <textarea
              ref={area}
              value={draft}
              onChange={(e) => onEdit(e.target.value)}
              spellCheck
              aria-label="Notes markdown"
              className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-fg focus:outline-none"
            />
          </div>
        )}
        {effectiveMode !== "edit" && (
          <div className="print-flow min-w-0 flex-1 overflow-y-auto">
            <article className="print-area mx-auto max-w-[820px] rounded-2xl bg-[#fbfaf7] px-6 py-8 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.8)] sm:px-12 sm:py-12">
              {note.sources?.length ? (
                <div className="mb-4 text-[12px] text-[#8a8170]">Based on: {note.sources.map((s) => s.name).join(", ")}</div>
              ) : null}
              {content ? (
                <MarkdownView content={content} streaming={generating} />
              ) : (
                <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[#8a8170]">
                  {generating ? (
                    <>
                      <Spinner size={16} /> The teacher is writing your notes…
                    </>
                  ) : (
                    "These notes are empty."
                  )}
                </div>
              )}
              <div className="print-only mt-8 border-t pt-2 text-[10px] text-[#8a8170]">Generated with ConceptAI</div>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-white/10 hover:text-fg">
      {children}
    </button>
  );
}
