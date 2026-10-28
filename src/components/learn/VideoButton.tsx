"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * Making one takes as long as the lesson plays, so it is started on its own as
 * soon as the lesson is fully written; by the time the student wants it, it is
 * usually ready and downloads at once. The Python helper makes it and keeps it
 * (python/helper/video.py), so asking again for the same lesson is instant.
 */
export function VideoButton({ lesson, ready }: { lesson: Lesson; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<VideoStatus | null>(null);
  const [error, setError] = useState("");
  const [wanted, setWanted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fetched = useRef<string | null>(null);
  const autoFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const sections = lesson.outline?.sections;
  const parts = useMemo(() => (sections ?? []).map((s) => ({ title: s.title, beats: lesson.sections[s.id]?.beats ?? [] })), [sections, lesson.sections]);

  /** Ask for this lesson's video: the helper answers with the one already made, the one being made, or a new one. */
  const request = useCallback(
    async (auto: boolean): Promise<VideoStatus | null> => {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: lesson.outline?.title ?? lesson.topic, language: lesson.language, parts, auto }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => null) : null;
      if (res?.ok && body) return body as VideoStatus;
      // A video started on its own fails quietly (no Python tools, others queued); a click shows why.
      if (!auto) setError(body?.message ?? (res ? `Error ${res.status}` : "The app didn't answer."));
      return null;
    },
    [lesson.outline?.title, lesson.topic, lesson.language, parts],
  );

  // Start making it as soon as the lesson is written (and again if a part is rewritten).
  const shape = `${lesson.id}:${parts.map((p) => p.beats.length).join(",")}`;
  useEffect(() => {
    if (!ready || autoFor.current === shape) return;
    autoFor.current = shape;
    void request(true).then((j) => j && setJob(j));
  }, [ready, shape, request]);

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

  // Only a click downloads; a video made on its own just waits, ready.
  useEffect(() => {
    if (!wanted || job?.state !== "done" || fetched.current === job.id) return;
    fetched.current = job.id;
    setWanted(false);
    window.location.assign(`/api/video/${job.id}/file`);
  }, [job, wanted]);

  const download = async () => {
    setError("");
    setWanted(true);
    // Asked afresh: instant once it's made (even after the app restarted), the same job while it's being made.
    const j = await request(false);
    if (j) setJob(j);
    else setWanted(false);
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
        title={job?.state === "done" ? "This lesson's video is ready to download" : ready ? "Download this lesson as a video (MP4)" : "Available once the whole lesson is written"}
        aria-label="Download as video"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-fg"
      >
        <Clapperboard size={17} />
        {busy && <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-accent" />}
        {job?.state === "done" && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-ok" />}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 animate-fade-in space-y-3 rounded-2xl border border-line-strong bg-surface-2 p-4 text-[13px] shadow-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Download as video</div>
          {job?.state === "done" ? (
            <>
              <p className="text-fg">Your video is ready: the whole lesson as an MP4, with the whiteboard, captions and the teacher&apos;s voice.</p>
              <button
                onClick={() => void download()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 font-medium text-white transition hover:brightness-110"
              >
                <Download size={15} /> Download
              </button>
            </>
          ) : busy ? (
            <>
              <div className="flex items-start gap-2">
                <Spinner size={14} className="mt-0.5 shrink-0" />
                <p className="text-fg">{step}</p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(Math.min(1, fraction) * 100)}%` }} />
              </div>
              <p className="text-[12px] text-muted">It&apos;s being made in the background (about as long as the lesson plays), so it&apos;s ready when you want it.</p>
              <button
                disabled={wanted}
                onClick={() => void download()}
                className="w-full rounded-lg border border-line-strong px-3 py-2 text-muted hover:bg-white/[0.05] disabled:opacity-60"
              >
                {wanted ? "It will download as soon as it's ready" : "Download when ready"}
              </button>
            </>
          ) : (
            <>
              {job?.state === "error" && <p className="text-danger">{step}</p>}
              {!ready ? (
                <p className="text-muted">Available once every part of the lesson is written and checked; it then starts being made on its own.</p>
              ) : (
                <button onClick={() => void download()} className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white transition hover:brightness-110">
                  {job?.state === "error" ? "Try again" : "Make the video"}
                </button>
              )}
              {error && <p className="text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
