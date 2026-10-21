"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, House, NotebookPen, Plus, Trash, X } from "lucide-react";
import { fetchStatus, type ServerStatus } from "@/lib/api";
import { store } from "@/lib/store";
import { useLists } from "@/lib/useLists";
import { cn, modelLabel, timeAgo } from "@/lib/utils";
import { Logo } from "@/components/ui";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const { lessons, notes } = useLists();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [storage, setStorage] = useState<string>("");
  useEffect(() => {
    void fetchStatus().then(setStatus);
    void store.backendName().then((n) => setStorage(n === "supabase" ? "Synced to Supabase" : "Saved in this browser"));
  }, []);

  const remove = async (kind: "lesson" | "note", id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
    if (kind === "lesson") await store.deleteLesson(id);
    else await store.deleteNote(id);
  };

  return (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Logo />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">ConceptAI</div>
          <div className="text-[11px] text-subtle">Your AI teacher</div>
        </div>
      </div>

      <div className="px-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-accent-strong to-accent text-sm font-medium text-white shadow-[0_8px_24px_-10px_rgb(139_123_255/0.8)] transition hover:brightness-110"
        >
          <Plus size={16} /> New lesson
        </Link>
      </div>

      <div className="mt-3 space-y-0.5 px-2">
        <NavLink href="/" icon={<House size={16} />} active={path === "/"} onClick={onNavigate}>
          Dashboard
        </NavLink>
        <NavLink href="/notes" icon={<NotebookPen size={16} />} active={path.startsWith("/notes")} onClick={onNavigate}>
          Exam notes
        </NavLink>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        <Section title="Recent lessons" empty={lessons?.length === 0 ? "Lessons you start appear here." : null}>
          {lessons?.slice(0, 30).map((l) => (
            <ListRow
              key={l.id}
              href={`/learn/${l.id}`}
              active={path === `/learn/${l.id}`}
              title={l.title}
              meta={`${l.sample ? "Sample · " : l.subject ? `${l.subject} · ` : ""}${timeAgo(l.updatedAt)}`}
              icon={<BookOpen size={14} />}
              onDelete={() => remove("lesson", l.id, l.title)}
              onClick={onNavigate}
            />
          ))}
        </Section>
        <Section title="Saved notes" empty={notes?.length === 0 ? "Generated notes are saved here." : null}>
          {notes?.slice(0, 30).map((n) => (
            <ListRow
              key={n.id}
              href={`/notes/${n.id}`}
              active={path === `/notes/${n.id}`}
              title={n.title}
              meta={timeAgo(n.updatedAt)}
              icon={<NotebookPen size={14} />}
              onDelete={() => remove("note", n.id, n.title)}
              onClick={onNavigate}
            />
          ))}
        </Section>
      </div>

      <div className="space-y-1.5 border-t border-line px-4 py-3 text-[12px] text-muted">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", status?.llm.configured ? "bg-ok" : status ? "bg-warn" : "bg-subtle")} />
          {status?.llm.configured ? (
            <span
              className="truncate"
              title={[
                status.llm.fast ? `Easy topics: ${modelLabel(status.llm.fast.model)}` : status.llm.model,
                status.llm.fallback ? `If it can't answer: ${status.llm.fallback}` : "",
              ]
                .filter(Boolean)
                .join("\n")}
            >
              AI: {status.llm.provider === "anthropic" ? modelLabel(status.llm.model) : `${providerName(status.llm.provider)} · ${status.llm.model}`}
              {status.llm.fast ? ` + ${modelLabel(status.llm.fast.model).replace(/^Claude /, "")}` : ""}
            </span>
          ) : status ? (
            <span>AI not configured (samples only)</span>
          ) : (
            <span>Checking AI…</span>
          )}
        </div>
        {status?.llm.problem && <div className="text-danger">{status.llm.problem}</div>}
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", status?.tts.configured ? "bg-ok" : "bg-subtle")} />
          Voice: {status?.tts.configured ? `AI (${status.tts.provider})` : "browser"}
        </div>
        {status?.llm.configured && (
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", status.llm.research === "off" ? "bg-subtle" : "bg-ok")} />
            Research: {status.llm.research === "web" ? "web search" : status.llm.research === "wikipedia" ? "Wikipedia" : "off"}
          </div>
        )}
        {storage && (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-subtle" />
            {storage}
          </div>
        )}
      </div>
    </nav>
  );
}

export function providerName(p?: string) {
  return p === "anthropic" ? "Claude" : p === "ollama" ? "Ollama" : p === "openai" ? "OpenAI-compatible" : (p ?? "");
}

function NavLink({ href, icon, active, children, onClick }: { href: string; icon: React.ReactNode; active: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
        active ? "bg-white/[0.07] text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty: string | null }) {
  return (
    <div>
      <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{title}</div>
      <div className="space-y-0.5">{children}</div>
      {empty && <div className="px-3 py-1 text-[12px] text-subtle">{empty}</div>}
    </div>
  );
}

function ListRow({
  href,
  active,
  title,
  meta,
  icon,
  onDelete,
  onClick,
}: {
  href: string;
  active: boolean;
  title: string;
  meta: string;
  icon: React.ReactNode;
  onDelete: () => void;
  onClick?: () => void;
}) {
  return (
    <div className={cn("group relative rounded-lg transition", active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}>
      <Link href={href} onClick={onClick} className="flex items-start gap-2.5 px-3 py-2 pr-9">
        <span className="mt-0.5 text-subtle">{icon}</span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[13px]", active ? "text-fg" : "text-fg/85")}>{title}</span>
          <span className="block truncate text-[11px] text-subtle">{meta}</span>
        </span>
      </Link>
      <button
        aria-label={`Delete ${title}`}
        onClick={onDelete}
        className="absolute right-1.5 top-2 hidden h-7 w-7 place-items-center rounded-md text-subtle hover:bg-danger/15 hover:text-danger group-hover:grid"
      >
        <Trash size={13} />
      </button>
    </div>
  );
}

export function MobileClose({ onClick }: { onClick: () => void }) {
  return (
    <button aria-label="Close menu" onClick={onClick} className="absolute right-3 top-4 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/5">
      <X size={18} />
    </button>
  );
}
