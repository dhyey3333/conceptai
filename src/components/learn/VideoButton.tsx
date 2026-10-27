"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Download } from "lucide-react";
import type { Lesson } from "@/lib/lesson/types";
import { Spinner } from "@/components/ui";

interface VideoStatus {
  id: string;
  state: "waiting" | "voice" | "recording" | "encoding" | "done" | "error";
  done: number;
  total: number;
  error?: string | null;
  lengthMs: number;
  recordedMs: number;
  /** 0..1 while the one-time voice download is still going (null once it's there). */
  voiceDownload?: number | null;
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

function stepText(job: VideoStatus): string {
  switch (job.state) {
    case "waiting":
      return "Waiting for another video to finish…";
    case "voice":
      return job.voiceDownload != null
        ? `Downloading the voice first (one time, about 120 MB): ${Math.round(job.voiceDownload * 100)}%`
        : `Recording the voice: ${job.done} of ${job.total} steps`;
    case "recording":
      return `Recording the board: ${clock(job.recordedMs)} of about ${clock(job.lengthMs)}`;
    case "encoding":
      return "Putting the video together…";
    case "done":
      return "Your video is ready.";
    case "error":
      return `It didn't work: ${job.error}`;
  }
}

/**
 * "Download video": the whole lesson as an MP4, with the teacher's voice.
 * The Python helper makes it (python/helper/video.py); this only starts it,
 * shows how far it has got, and downloads the file when it is ready.
 */
export function VideoButton({ lesson, ready }: { lesson: Lesson; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<VideoStatus | null>(null);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const fetched = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  // Follow the job until it is done (it keeps going on the server if this panel is closed).
  const busy = !!job && job.state !== "done" && job.state !== "error";
  useEffect(() => {
    if (!job || !busy) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/video/${job.id}`).catch(() => null);
      if (res?.ok) setJob(await res.json());
      else setJob({ ...job, state: "error", error: res ? ((await res.json().catch(() => null))?.message ?? `Error ${res.status}`) : "The app didn't answer." });
    }, 1500);
    return () => clearTimeout(t);
  }, [job, busy]);

  // Download once, as soon as it is ready.
  useEffect(() => {
    if (job?.state !== "done" || fetched.current === job.id) return;
    fetched.current = job.id;
    window.location.assign(`/api/video/${job.id}/file`);
  }, [job]);

  const start = async () => {
    setError("");
    setJob(null);
    const parts = (lesson.outline?.sections ?? []).map((s) => ({ title: s.title, beats: lesson.sections[s.id]?.beats ?? [] }));
    const res = await fetch("/api/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: lesson.outline?.title ?? lesson.topic, language: lesson.language, parts }),
    }).catch(() => null);
    if (!res) return setError("The app didn't answer.");
    const body = await res.json().catch(() => null);
    if (!res.ok) return setError(body?.message ?? `Error ${res.status}`);
    setJob(body as VideoStatus);
  };

  const step = job ? stepText(job) : "";
  const fraction =
    job?.state === "voice"
      ? job.voiceDownload != null
        ? job.voiceDownload
        : job.done / Math.max(1, job.total)
      : job?.state === "recording"
        ? job.recordedMs / Math.max(1, job.lengthMs)
        : 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={ready ? "Download this lesson as a video (MP4)" : "Available once the whole lesson is written"}
        aria-label="Download as video"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-fg"
      >
        <Clapperboard size={17} />
        {busy && <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-accent" />}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 animate-fade-in space-y-3 rounded-2xl border border-line-strong bg-surface-2 p-4 text-[13px] shadow-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Download as video</div>
          {!job ? (
            <>
              <p className="text-muted">
                The whole lesson as an MP4: the whiteboard, captions and a natural voice made on this computer. It plays through in real time, so a 10-minute lesson takes
                about 10 minutes; you can keep learning meanwhile.
              </p>
              <button
                disabled={!ready}
                onClick={() => void start()}
                className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white transition hover:brightness-110 disabled:opacity-40"
              >
                Make the video
              </button>
              {!ready && <p className="text-[11px] text-subtle">Available once every part of the lesson is written and checked.</p>}
              {error && <p className="text-danger">{error}</p>}
            </>
          ) : (
            <>
              <div className="flex items-start gap-2">
                {busy && <Spinner size={14} className="mt-0.5 shrink-0" />}
                <p className={job.state === "error" ? "text-danger" : "text-fg"}>{step}</p>
              </div>
              {busy && (
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(Math.min(1, fraction) * 100)}%` }} />
                </div>
              )}
              {job.state === "done" && (
                <a href={`/api/video/${job.id}/file`} className="flex items-center justify-center gap-2 rounded-lg border border-line-strong px-3 py-2 hover:bg-white/[0.05]">
                  <Download size={15} /> Download again
                </a>
              )}
              {!busy && (
                <button onClick={() => void start()} className="w-full rounded-lg border border-line-strong px-3 py-2 text-muted hover:bg-white/[0.05]">
                  Make it again
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
