"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { sanitizeBeat, type Beat } from "@/lib/board/schema";
import { allocateTimings, drawBudgetMs, type ItemTiming } from "@/lib/board/timing";
import { splitSentences } from "@/lib/voice/speaker";
import { Whiteboard, type BoardEntry } from "@/components/board/Whiteboard";

/**
 * The page a lesson video is recorded from: python/helper/video.py opens it in
 * headless Chromium and records it. It plays the lesson on the whiteboard by
 * itself, each beat lasting exactly as long as its narration clip, and notes
 * when each beat starts so the voice can be laid over the recording at the
 * right moments. There is nothing to click: no toolbar, no sidebar.
 */

interface RenderData {
  title: string;
  parts: { title: string; beats: Beat[] }[];
  /** Narration length of each beat, in ms (0: no narration). */
  durations: number[][];
  leadMs: number;
  tailMs: number;
}

/** How the recorder drives and follows the page. */
interface RenderControl {
  ready: boolean;
  done: boolean;
  index: number;
  /** When each beat started (epoch ms), to place its voice clip. */
  starts: (number | null)[];
  start: () => void;
}

declare global {
  interface Window {
    __render?: RenderControl;
  }
}

const GAP_MS = 420; // the pause between beats, as in a live lesson
const SILENT_BEAT_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RenderPage() {
  const { job } = useParams<{ job: string }>();
  const [data, setData] = useState<RenderData | null>(null);
  const [error, setError] = useState("");
  const [pos, setPos] = useState<{ part: number; beat: number; timings: ItemTiming[] } | null>(null);
  const [caption, setCaption] = useState("");
  const captionTimers = useRef<number[]>([]);

  useEffect(() => {
    fetch(`/api/video/${job}/data`)
      .then((r) => (r.ok ? (r.json() as Promise<RenderData>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      // Validated again here: this page draws whatever it is given.
      .then((d) => setData({ ...d, parts: d.parts.map((p) => ({ ...p, beats: p.beats.map((b) => sanitizeBeat(b) ?? { say: "", draw: [] }) })) }))
      .catch((e) => setError(String(e)));
  }, [job]);

  useEffect(() => {
    if (!data) return;
    const total = data.parts.reduce((n, p) => n + p.beats.length, 0);
    // Captions follow the narration sentence by sentence, each shown for its share of the clip.
    const showCaptions = (say: string, ms: number) => {
      captionTimers.current.forEach(clearTimeout);
      const sentences = splitSentences(say);
      const chars = sentences.reduce((n, s) => n + s.length, 0) || 1;
      let at = 0;
      captionTimers.current = sentences.map((s) => {
        const t = window.setTimeout(() => setCaption(s), at);
        at += (ms * s.length) / chars;
        return t;
      });
      if (!sentences.length) setCaption("");
    };
    const play = async () => {
      await sleep(data.leadMs);
      let g = 0;
      for (let p = 0; p < data.parts.length; p++) {
        for (let b = 0; b < data.parts[p].beats.length; b++, g++) {
          const beat = data.parts[p].beats[b];
          const speechMs = data.durations[p]?.[b] ?? 0;
          // Timed exactly as a live lesson times a beat to its speech (session.ts).
          const timings = allocateTimings(beat.draw, drawBudgetMs(beat.draw, speechMs, 1));
          const last = timings[timings.length - 1];
          const drawMs = last ? last.start + last.dur : 0;
          control.index = g;
          control.starts[g] = Date.now();
          setPos({ part: p, beat: b, timings });
          showCaptions(beat.say, speechMs);
          await sleep(Math.max(speechMs, drawMs, speechMs ? 0 : SILENT_BEAT_MS) + GAP_MS);
        }
      }
      setCaption("");
      await sleep(data.tailMs);
      control.index = total;
      control.done = true;
    };
    const control: RenderControl = { ready: false, done: false, index: 0, starts: Array(total).fill(null), start: () => void play() };
    window.__render = control;
    void document.fonts.ready.then(() => (control.ready = true));
    return () => captionTimers.current.forEach(clearTimeout);
  }, [data]);

  // Everything drawn so far on this part's board; only the current beat's items animate.
  const entries = useMemo<BoardEntry[]>(() => {
    if (!data || !pos) return [];
    const beats = data.parts[pos.part].beats;
    return beats.slice(0, pos.beat + 1).flatMap((beat, b) =>
      beat.draw.map((item, i) => ({ key: `${pos.part}.${b}.${i}`, item, timing: b === pos.beat ? (pos.timings[i] ?? null) : null })),
    );
  }, [data, pos]);

  if (error) return <div className="grid h-dvh place-items-center text-danger">Could not load this video: {error}</div>;
  const part = data && pos ? data.parts[pos.part] : null;
  return (
    <div className="render-video flex h-dvh flex-col bg-bg p-3">
      <div className="flex h-9 shrink-0 items-center gap-3 px-2 text-sm">
        <span className="font-semibold text-fg">{data?.title}</span>
        {part && <span className="truncate text-muted">· Part {pos!.part + 1}: {part.title}</span>}
        <span className="ml-auto text-xs text-subtle">ConceptAI</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <Whiteboard
          entries={entries}
          paused={false}
          pointedId={part ? (part.beats[pos!.beat].point ?? null) : null}
          ink={[]}
          onInkChange={() => {}}
          selectedKey={null}
          onSelect={() => {}}
          pageKey={String(pos?.part ?? "title")}
        />
        {!pos && data && (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-bg/80">
            <div className="text-center">
              <div className="text-sm uppercase tracking-widest text-accent">A ConceptAI lesson</div>
              <div className="mt-3 max-w-3xl text-4xl font-bold text-fg">{data.title}</div>
            </div>
          </div>
        )}
        {caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-10">
            <div className="max-w-4xl rounded-xl bg-black/80 px-5 py-2.5 text-center text-lg leading-snug text-white">{caption}</div>
          </div>
        )}
      </div>
    </div>
  );
}
