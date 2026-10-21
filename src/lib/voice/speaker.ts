/**
 * The teacher's voice.
 *
 * - CloudSpeaker: AI voice from /api/tts (OpenAI-compatible or ElevenLabs).
 *   Audio is fetched ahead of time, so the real duration is known before the
 *   beat starts and the board drawing can be timed to it exactly.
 * - BrowserSpeaker: the Web Speech API. Text is spoken sentence by sentence,
 *   which works around Chrome cutting off long utterances, gives captions a
 *   sentence to highlight, and makes pause/resume reliable (we restart the
 *   current sentence instead of relying on speechSynthesis.pause()).
 * - Silence: when the voice is off, the beat lasts as long as reading it would.
 */
import { estimateSpeechMs } from "@/lib/board/timing";
import { PausableTimer } from "./timer";

export interface SpeakHandle {
  done: Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
}

export interface SpeakOptions {
  rate: number;
  onSentence?: (index: number, sentence: string) => void;
}

export interface Speaker {
  kind: "cloud" | "browser" | "silent";
  /** Optional pre-fetch; resolves to the audio duration in ms at 1x when known. */
  prepare(text: string): Promise<number | null>;
  speak(text: string, opts: SpeakOptions): SpeakHandle;
  stop(): void;
}

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?।]+[.!?।]+["')\]]*\s*|[^.!?।]+$/g) ?? [text];
  // Merge fragments that are too short to speak naturally on their own.
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    if (out.length && (out[out.length - 1].length < 25 || p.length < 12)) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------

export function silentSpeak(text: string, opts: SpeakOptions): SpeakHandle {
  const sentences = splitSentences(text);
  const timers: PausableTimer[] = [];
  let cancelled = false;
  let current: PausableTimer | null = null;
  const done = (async () => {
    for (let i = 0; i < sentences.length && !cancelled; i++) {
      opts.onSentence?.(i, sentences[i]);
      current = new PausableTimer(estimateSpeechMs(sentences[i], opts.rate));
      timers.push(current);
      await current.promise;
    }
  })();
  return {
    done,
    pause: () => current?.pause(),
    resume: () => current?.resume(),
    cancel: () => {
      cancelled = true;
      timers.forEach((t) => t.finish());
    },
  };
}

export const silentSpeaker: Speaker = {
  kind: "silent",
  prepare: async () => null,
  speak: silentSpeak,
  stop: () => {},
};

// ---------------------------------------------------------------------------

export function browserSpeechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function listVoices(): SpeechSynthesisVoice[] {
  return browserSpeechAvailable() ? window.speechSynthesis.getVoices() : [];
}

const QUALITY = /(natural|neural|online|premium|enhanced|google)/i;

/** Pick a good default voice for the lesson language. */
export function pickVoice(lang: "english" | "hinglish" | "hindi", preferredURI?: string): SpeechSynthesisVoice | null {
  const voices = listVoices();
  if (!voices.length) return null;
  if (preferredURI) {
    const v = voices.find((x) => x.voiceURI === preferredURI);
    if (v) return v;
  }
  const score = (v: SpeechSynthesisVoice) => {
    const l = v.lang.toLowerCase();
    let s = 0;
    if (lang === "hindi") s += l.startsWith("hi") ? 100 : l === "en-in" ? 40 : 0;
    else if (lang === "hinglish") s += l === "en-in" ? 100 : l.startsWith("hi") ? 60 : l.startsWith("en") ? 50 : 0;
    else s += l === "en-in" ? 90 : l.startsWith("en-us") || l.startsWith("en-gb") ? 85 : l.startsWith("en") ? 70 : 0;
    if (QUALITY.test(v.name)) s += 20;
    if (v.localService === false) s += 3;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export class BrowserSpeaker implements Speaker {
  kind = "browser" as const;
  constructor(private voice: () => SpeechSynthesisVoice | null) {}

  async prepare(): Promise<number | null> {
    return null;
  }

  stop(): void {
    if (browserSpeechAvailable()) window.speechSynthesis.cancel();
  }

  speak(text: string, opts: SpeakOptions): SpeakHandle {
    const synth = window.speechSynthesis;
    const sentences = splitSentences(text);
    let index = 0;
    let paused = false;
    let cancelled = false;
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    let watchdog: PausableTimer | null = null;

    const sayCurrent = () => {
      if (cancelled || paused) return;
      if (index >= sentences.length) return finish();
      const sentence = sentences[index];
      opts.onSentence?.(index, sentence);
      const u = new SpeechSynthesisUtterance(sentence);
      const v = this.voice();
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = Math.min(2, Math.max(0.5, opts.rate));
      const myIndex = index;
      const next = () => {
        watchdog?.finish();
        if (cancelled || paused || myIndex !== index) return;
        index++;
        sayCurrent();
      };
      u.onend = next;
      u.onerror = (e) => {
        // "interrupted"/"canceled" come from our own pause/cancel.
        if (e.error === "interrupted" || e.error === "canceled") return;
        next();
      };
      // Some systems never fire onend (no voices installed); don't hang the lesson.
      watchdog?.finish();
      watchdog = new PausableTimer(estimateSpeechMs(sentence, opts.rate) * 2.5 + 2500);
      watchdog.promise.then(() => {
        if (!cancelled && !paused && myIndex === index && synth.speaking === false) next();
      });
      synth.speak(u);
    };

    // Chrome can drop an utterance queued right after cancel(), so only cancel when needed.
    if (synth.speaking || synth.pending) synth.cancel();
    sayCurrent();
    return {
      done,
      pause: () => {
        if (paused || cancelled) return;
        paused = true;
        watchdog?.pause();
        synth.cancel();
      },
      resume: () => {
        if (!paused || cancelled) return;
        paused = false;
        sayCurrent(); // restart the interrupted sentence
      },
      cancel: () => {
        cancelled = true;
        watchdog?.finish();
        synth.cancel();
        finish();
      },
    };
  }
}

// ---------------------------------------------------------------------------

/** AI voice. Falls back to the browser voice if a request fails. */
export class CloudSpeaker implements Speaker {
  kind = "cloud" as const;
  private cache = new Map<string, Promise<{ url: string; ms: number } | null>>();
  private audio: HTMLAudioElement | null = null;

  constructor(private fallback: Speaker) {}

  private load(text: string) {
    let p = this.cache.get(text);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.slice(0, 1200) }),
          });
          if (!res.ok) return null;
          const url = URL.createObjectURL(await res.blob());
          const ms = await new Promise<number>((resolve) => {
            const a = new Audio();
            a.preload = "metadata";
            a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration * 1000 : 0);
            a.onerror = () => resolve(0);
            a.src = url;
          });
          return { url, ms };
        } catch {
          return null;
        }
      })();
      this.cache.set(text, p);
      if (this.cache.size > 40) {
        const [firstKey, first] = this.cache.entries().next().value!;
        this.cache.delete(firstKey);
        first.then((r) => r && URL.revokeObjectURL(r.url));
      }
    }
    return p;
  }

  async prepare(text: string): Promise<number | null> {
    const r = await this.load(text);
    return r?.ms || null;
  }

  stop(): void {
    this.audio?.pause();
    this.fallback.stop();
  }

  speak(text: string, opts: SpeakOptions): SpeakHandle {
    let inner: SpeakHandle | null = null;
    let cancelled = false;
    let paused = false;
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    (async () => {
      const r = await this.load(text);
      if (cancelled) return;
      if (!r) {
        inner = this.fallback.speak(text, opts);
        if (paused) inner.pause();
        await inner.done;
        return finish();
      }
      opts.onSentence?.(0, text);
      const a = new Audio(r.url);
      this.audio = a;
      a.playbackRate = opts.rate;
      a.onended = () => finish();
      a.onerror = () => finish();
      if (!paused) a.play().catch(() => finish());
    })();
    return {
      done,
      pause: () => {
        paused = true;
        inner?.pause();
        this.audio?.pause();
      },
      resume: () => {
        paused = false;
        inner?.resume();
        this.audio?.play().catch(() => finish());
      },
      cancel: () => {
        cancelled = true;
        inner?.cancel();
        this.audio?.pause();
        finish();
      },
    };
  }
}
