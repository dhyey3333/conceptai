"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Spinner } from "@/components/ui";

export interface Source {
  name: string;
  text: string;
  chars: number;
  pages?: number;
  truncated?: boolean;
}

const ACCEPT = ".pdf,.pptx,.docx,.txt,.md,application/pdf,text/plain,text/markdown";

/** Attach a syllabus, PDF or slide deck; its text is extracted on the server. */
export function SourceUpload({
  sources,
  onChange,
  multiple = false,
  label = "Attach syllabus / slides",
}: {
  sources: Source[];
  onChange: (s: Source[]) => void;
  multiple?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: Source[] = [];
    for (const file of Array.from(files).slice(0, multiple ? 5 : 1)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? "Couldn't read that file.");
        added.push(data as Source);
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    onChange(multiple ? [...sources, ...added].slice(0, 5) : added.slice(0, 1).concat(added.length ? [] : sources));
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sources.map((s, i) => (
        <span key={s.name + i} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-accent-2/30 bg-accent-2/10 px-2.5 py-1 text-[12px] text-fg">
          <FileText size={13} className="shrink-0 text-accent-2" />
          <span className="truncate">{s.name}</span>
          <span className="shrink-0 text-muted">
            {s.pages ? `${s.pages} pages · ` : ""}
            {Math.round(s.chars / 1000)}k chars{s.truncated ? " (trimmed)" : ""}
          </span>
          <button aria-label={`Remove ${s.name}`} onClick={() => onChange(sources.filter((_, j) => j !== i))} className="text-muted hover:text-fg">
            <X size={13} />
          </button>
        </span>
      ))}
      {(multiple || sources.length === 0) && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-2.5 py-1 text-[12px] text-muted transition hover:border-white/30 hover:text-fg"
        >
          {busy ? <Spinner size={13} /> : <Paperclip size={13} />}
          {busy ? "Reading file…" : label}
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT} multiple={multiple} hidden onChange={(e) => void upload(e.target.files)} />
      {error && <span className="w-full text-[12px] text-danger">{error}</span>}
    </div>
  );
}
