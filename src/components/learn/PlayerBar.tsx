"use client";

import { Captions, Lightbulb, Mic, MicOff, Pause, Play, Repeat, SkipBack, SkipForward, Sparkles, Volume2, VolumeX } from "lucide-react";
import type { LessonSession, SessionState } from "@/lib/lesson/session";
import { updateSettings, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerBar({
  s,
  session,
  onMic,
  canAsk,
}: {
  s: SessionState;
  session: LessonSession;
  onMic: () => void;
  canAsk: boolean;
}) {
  const settings = useSettings();
  const total = s.timeline.length;
  const playing = s.phase === "playing";
  const buffering = s.phase === "buffering";
  const sections = s.lesson.outline?.sections ?? [];
  // Where each section starts on the progress bar.
  const marks = sections
    .map((sec, i) => ({ i, title: sec.title, at: s.timeline.findIndex((t) => t.sectionIndex === i) }))
    .filter((m) => m.at > 0);
  const progress = total ? Math.min(1, (s.index + (s.beatStarted ? 0.5 : 0)) / total) : 0;

  return (
    <div className="no-print rounded-2xl border border-line bg-surface px-3 py-2.5">
      {/* progress */}
      <div
        className="group relative mb-2.5 h-1.5 cursor-pointer rounded-full bg-white/10"
        role="slider"
        aria-label="Lesson progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={s.index}
        tabIndex={-1}
        onClick={(e) => {
          if (!total) return;
          const r = e.currentTarget.getBoundingClientRect();
          session.seek(Math.floor(((e.clientX - r.left) / r.width) * total));
        }}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
        {marks.map((m) => (
          <span key={m.i} title={m.title} className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded bg-white/35" style={{ left: `${(m.at / total) * 100}%` }} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <IconBtn label="Previous step (←)" onClick={() => session.prev()} disabled={s.index === 0}>
          <SkipBack size={17} />
        </IconBtn>
        <button
          onClick={() => session.toggle()}
          aria-label={playing || buffering ? "Pause (Space)" : "Play (Space)"}
          title={playing || buffering ? "Pause (Space)" : "Play (Space)"}
          disabled={!total && !buffering && s.phase !== "idle"}
          className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-b from-accent-strong to-accent text-white shadow-[0_6px_20px_-6px_rgb(139_123_255/0.8)] transition hover:brightness-110 disabled:opacity-40"
        >
          {buffering ? <Spinner size={18} className="text-white" /> : playing ? <Pause size={19} /> : <Play size={19} className="translate-x-[1px]" />}
        </button>
        <IconBtn label="Next step (→)" onClick={() => session.next()} disabled={s.index >= total}>
          <SkipForward size={17} />
        </IconBtn>
        <IconBtn label="Repeat this step" onClick={() => session.repeat()} disabled={!total}>
          <Repeat size={16} />
        </IconBtn>

        <div className="mx-1 hidden h-6 w-px bg-line-strong sm:block" />

        <IconBtn
          label={s.voiceOn ? "Mute teacher" : "Unmute teacher"}
          onClick={() => {
            session.setVoiceOn(!s.voiceOn);
            updateSettings({ voiceOn: !s.voiceOn });
          }}
          active={s.voiceOn}
        >
          {s.voiceOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </IconBtn>
        <select
          aria-label="Playback speed"
          title="Speaking and drawing speed"
          value={s.rate}
          onChange={(e) => {
            const r = Number(e.target.value);
            session.setRate(r);
            updateSettings({ rate: r });
          }}
          className="h-8 rounded-lg border border-line-strong bg-surface-3 px-1.5 text-[13px] text-fg focus:outline-none"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <IconBtn label={settings.captions ? "Hide captions" : "Show captions"} onClick={() => updateSettings({ captions: !settings.captions })} active={settings.captions}>
          <Captions size={17} />
        </IconBtn>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void session.ask("", "simpler", { onBoard: true })}
            disabled={!canAsk || s.asking}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] text-muted transition hover:border-white/25 hover:text-fg disabled:opacity-40 md:inline-flex"
            title="Ask the teacher to re-explain this part more simply"
          >
            <Lightbulb size={15} /> Simpler
          </button>
          <button
            onClick={() => void session.ask("", "example", { onBoard: true })}
            disabled={!canAsk || s.asking}
            className="hidden h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] text-muted transition hover:border-white/25 hover:text-fg disabled:opacity-40 md:inline-flex"
            title="Ask for another worked example"
          >
            <Sparkles size={15} /> Example
          </button>
          <button
            onClick={onMic}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition",
              s.mic === "listening"
                ? "bg-danger text-white shadow-[0_0_0_6px_rgb(248_113_113/0.2)]"
                : "bg-white/[0.08] text-fg hover:bg-white/[0.13]",
            )}
            title="Interrupt and ask by voice (M)"
          >
            {s.mic === "listening" ? <MicOff size={16} /> : <Mic size={16} />}
            {s.mic === "listening" ? "Done" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-lg transition disabled:opacity-35",
        active ? "text-fg" : "text-muted",
        "hover:bg-white/[0.07] hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
