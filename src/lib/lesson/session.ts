"use client";

/**
 * LessonSession: one open lesson. It owns
 *  - generation: outline, then each section's beats streamed in order, while
 *    the teacher is already speaking the first ones;
 *  - playback: for every beat, speak the narration and draw its items over
 *    the same time span, pausable as one unit;
 *  - interruptions: a question pauses the beat, the answer is spliced into the
 *    timeline right after it (drawn on the board and spoken), then the lesson
 *    carries on;
 *  - persistence of progress, ink, Q&A, quiz and notes links.
 * React reads it through useSyncExternalStore (see useLessonSession).
 */
import type { BoardItem } from "@/lib/board/schema";
import { summarizeItems } from "@/lib/board/summary";
import { allocateTimings, drawBudgetMs, estimateSpeechMs, type ItemTiming } from "@/lib/board/timing";
import { speakable } from "@/lib/math/render";
import { ApiError, postJson, streamNdjson } from "@/lib/api";
import { generateNote } from "@/lib/notes/generate";
import type { Quiz } from "@/lib/quiz/schema";
import type { Settings } from "@/lib/settings";
import { store } from "@/lib/store";
import { browserSpeechAvailable, BrowserSpeaker, CloudSpeaker, pickVoice, silentSpeak, silentSpeaker, type SpeakHandle, type Speaker } from "@/lib/voice/speaker";
import { PausableTimer } from "@/lib/voice/timer";
import { buildTimeline, isGenerating, pageItems, START_KEY, type TimelineBeat } from "./timeline";
import { newId, type AskMode, type ChatMessage, type Lesson, type Note, type Outline, type QaEntry, type Stroke } from "./types";

export type Phase = "idle" | "playing" | "paused" | "buffering" | "ended";

export interface SessionState {
  lesson: Lesson;
  timeline: TimelineBeat[];
  index: number;
  beatStarted: boolean;
  timings: ItemTiming[] | null;
  replays: Record<string, number>;
  phase: Phase;
  caption: string;
  pointed: string | null;
  viewSection: string | null;
  notice: string | null;
  asking: boolean;
  mic: "off" | "listening";
  interim: string;
  rate: number;
  voiceOn: boolean;
  quizLoading: boolean;
  quizError: string | null;
}

export interface SessionEnv {
  llm: boolean;
  llmProvider?: string;
  tts: boolean;
  settings: Settings;
}

/** Lessons saved mid-generation are resumed cleanly. */
function normalise(lesson: Lesson): Lesson {
  const sections = { ...lesson.sections };
  for (const [id, s] of Object.entries(sections)) {
    if (s.status === "loading") sections[id] = { status: "pending", beats: [] };
  }
  return {
    ...lesson,
    status: lesson.status === "outlining" ? "new" : lesson.status,
    sections,
    qa: lesson.qa.filter((q) => q.beats.length).map((q) => (q.status === "loading" ? { ...q, status: "ready" } : q)),
    chat: lesson.chat.map((m) => (m.pending ? { ...m, pending: false } : m)),
  };
}

export class LessonSession {
  private state: SessionState;
  private listeners = new Set<() => void>();
  private runId = 0;
  private speech: SpeakHandle | null = null;
  private timers: PausableTimer[] = [];
  private aborts = new Set<AbortController>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private chainRunning = false;
  private waitQa: string | null = null;
  private stopAfterQa: string | null = null;
  private resumeAfterMic = false;
  private speaker: Speaker;
  private env: SessionEnv;

  constructor(lesson: Lesson, env: SessionEnv) {
    this.env = env;
    const l = normalise(lesson);
    const timeline = buildTimeline(l);
    const index = Math.min(l.progress.index, timeline.length);
    this.speaker = this.makeSpeaker();
    this.state = {
      lesson: l,
      timeline,
      index,
      beatStarted: false,
      timings: null,
      replays: {},
      phase: index >= timeline.length && timeline.length > 0 && !isGenerating(l) ? "ended" : index > 0 ? "paused" : "idle",
      caption: "",
      pointed: null,
      viewSection: null,
      notice: null,
      asking: false,
      mic: "off",
      interim: "",
      rate: env.settings.rate,
      voiceOn: env.settings.voiceOn,
      quizLoading: false,
      quizError: null,
    };
  }

  // --- store plumbing ------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  private set(patch: Partial<SessionState>) {
    if (this.destroyed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private updateLesson(mut: (l: Lesson) => Lesson, save: "debounce" | "now" | "none" = "debounce", notifyLists = false) {
    if (this.destroyed) return;
    const lesson = { ...mut(this.state.lesson), updatedAt: Date.now() };
    const timeline = buildTimeline(lesson);
    this.set({ lesson, timeline });
    if (save === "now") void this.flush(notifyLists);
    else if (save === "debounce") this.scheduleSave();
    this.maybeLeaveBuffering();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(false), 900);
  }

  private async flush(notifyLists: boolean) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const l = { ...this.state.lesson, progress: { index: this.state.index } };
    try {
      await store.saveLesson(l, !notifyLists);
    } catch (e) {
      console.warn("[conceptai] save failed", e);
    }
  }

  private makeSpeaker(): Speaker {
    const s = this.env.settings;
    const browser = browserSpeechAvailable()
      ? new BrowserSpeaker(() => pickVoice(this.state?.lesson.language ?? "english", this.env.settings.browserVoice))
      : silentSpeaker;
    return s.voiceEngine === "ai" && this.env.tts ? new CloudSpeaker(browser) : browser;
  }

  updateEnv(env: Partial<SessionEnv>) {
    const engineChanged = env.settings && (env.settings.voiceEngine !== this.env.settings.voiceEngine || env.tts !== undefined);
    this.env = { ...this.env, ...env, settings: env.settings ?? this.env.settings };
    if (engineChanged) this.speaker = this.makeSpeaker();
  }

  destroy() {
    this.runId++;
    this.clearCurrent();
    this.speaker.stop();
    this.aborts.forEach((a) => a.abort());
    void this.flush(true);
    this.destroyed = true;
    this.listeners.clear();
  }

  // --- derived ---------------------------------------------------------------

  get sections() {
    return this.state.lesson.outline?.sections ?? [];
  }

  /** The board page on screen: the one the user picked, or the one being taught. */
  currentSectionId(s: SessionState = this.state): string | undefined {
    if (s.viewSection) return s.viewSection;
    // Before a beat starts, keep showing the page that was last drawn on.
    const i = s.beatStarted || s.index === 0 ? s.index : s.index - 1;
    const t = s.timeline[Math.min(i, s.timeline.length - 1)];
    return t?.sectionId ?? s.lesson.outline?.sections[0]?.id;
  }

  // --- generation -------------------------------------------------------------

  async generate() {
    const l = this.state.lesson;
    if (this.chainRunning || l.sample || this.destroyed) return;
    if (!this.env.llm) {
      if (!l.outline) this.updateLesson((x) => ({ ...x, status: "error", error: "llm_not_configured" }), "none");
      return;
    }
    this.chainRunning = true;
    try {
      if (!this.state.lesson.outline) {
        const ok = await this.generateOutline();
        if (!ok) return;
      }
      const sections = this.sections;
      for (let i = 0; i < sections.length; i++) {
        if (this.destroyed) return;
        if (this.state.lesson.sections[sections[i].id]?.status === "ready") continue;
        const ok = await this.generateSection(i);
        if (!ok) return;
        // Notes generate alongside the lesson (after the first section, so the
        // lesson starts fast). A local model can't do both at once, so wait.
        if (i === 0 && this.env.llmProvider !== "ollama") this.maybeStartNotes();
      }
      this.maybeStartNotes();
    } finally {
      this.chainRunning = false;
      this.set({});
    }
  }

  private track(): AbortController {
    const a = new AbortController();
    this.aborts.add(a);
    return a;
  }

  private async generateOutline(): Promise<boolean> {
    const l = this.state.lesson;
    this.updateLesson((x) => ({ ...x, status: "outlining", error: undefined }), "none");
    const ctrl = this.track();
    try {
      const { outline } = await postJson<{ outline: Outline }>(
        "/api/lesson/outline",
        { topic: l.topic, level: l.level, language: l.language, depth: l.depth, sourceText: l.sourceText },
        ctrl.signal,
      );
      this.updateLesson(
        (x) => ({
          ...x,
          status: "ready",
          outline,
          sections: Object.fromEntries(outline.sections.map((s) => [s.id, { status: "pending" as const, beats: [] }])),
        }),
        "now",
        true,
      );
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      this.updateLesson((x) => ({ ...x, status: "error", error: e instanceof Error ? e.message : "Couldn't plan the lesson." }), "now");
      return false;
    } finally {
      this.aborts.delete(ctrl);
    }
  }

  private async generateSection(i: number): Promise<boolean> {
    const l = this.state.lesson;
    const outline = l.outline!;
    const id = outline.sections[i].id;
    const patchSection = (s: Lesson["sections"][string]) => this.updateLesson((x) => ({ ...x, sections: { ...x.sections, [id]: s } }));
    patchSection({ status: "loading", beats: [] });
    const ctrl = this.track();
    const beats: Lesson["sections"][string]["beats"] = [];
    try {
      await streamNdjson(
        "/api/lesson/section",
        { topic: l.topic, level: l.level, language: l.language, depth: l.depth, outline, sectionIndex: i, sourceText: l.sourceText },
        (ev) => {
          if (ev.type === "beat") {
            beats.push(ev.beat as (typeof beats)[number]);
            patchSection({ status: "loading", beats: [...beats] });
          }
        },
        ctrl.signal,
      );
      if (!beats.length) throw new ApiError("The model returned no teachable content for this part.");
      patchSection({ status: "ready", beats: [...beats] });
      void this.flush(false);
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      const message = e instanceof Error ? e.message : "Generation failed.";
      // Keep a usable partial section rather than throwing it away.
      if (beats.length >= 3) {
        patchSection({ status: "ready", beats: [...beats] });
        this.set({ notice: `Part ${i + 1} was cut short: ${message}` });
        return true;
      }
      patchSection({ status: "error", beats: [], error: message });
      void this.flush(false);
      return false;
    } finally {
      this.aborts.delete(ctrl);
    }
  }

  retrySection(i: number) {
    const id = this.sections[i]?.id;
    if (!id) return;
    this.updateLesson((x) => ({ ...x, sections: { ...x.sections, [id]: { status: "pending", beats: [] } } }), "none");
    void this.generate();
  }

  retryOutline() {
    this.updateLesson((x) => ({ ...x, status: "new", error: undefined }), "none");
    void this.generate();
  }

  // --- notes & quiz -------------------------------------------------------------

  private outlineText(): string {
    const o = this.state.lesson.outline;
    if (!o) return "";
    return o.sections.map((s, i) => `${i + 1}. ${s.title}: ${s.goal}`).join("\n");
  }

  private maybeStartNotes() {
    const l = this.state.lesson;
    if (!this.env.settings.autoNotes || !this.env.llm || l.noteId || !l.outline || l.sample) return;
    void this.startNotes();
  }

  async startNotes(marks: number[] = [2, 5, 10, 15]): Promise<string | undefined> {
    const l = this.state.lesson;
    if (!l.outline || !this.env.llm) return;
    const now = Date.now();
    const note: Note = {
      id: newId("n"),
      title: `${l.outline.title}: Exam Notes`,
      topic: l.topic,
      level: l.level,
      marks,
      content: "",
      lessonId: l.id,
      sources: l.sourceName ? [{ name: l.sourceName, chars: l.sourceText?.length ?? 0 }] : undefined,
      sourceText: l.sourceText,
      outline: this.outlineText(),
      status: "generating",
      createdAt: now,
      updatedAt: now,
    };
    this.updateLesson((x) => ({ ...x, noteId: note.id }), "now");
    void generateNote(note, {
      topic: l.outline.title || l.topic,
      level: l.level,
      marks,
      outline: this.outlineText(),
      sourceText: l.sourceText,
      sourceNames: l.sourceName ? [l.sourceName] : undefined,
    });
    return note.id;
  }

  async generateQuiz() {
    const l = this.state.lesson;
    if (!this.env.llm) {
      this.set({ quizError: "Practice questions need an AI provider. Add LLM_API_KEY in .env.local." });
      return;
    }
    this.set({ quizLoading: true, quizError: null });
    const ctrl = this.track();
    try {
      const recent = this.state.timeline
        .map((t) => t.beat.say)
        .filter(Boolean)
        .join(" ")
        .slice(0, 7000);
      const { quiz } = await postJson<{ quiz: Quiz }>(
        "/api/quiz",
        { topic: l.outline?.title ?? l.topic, level: l.level, outline: this.outlineText() || undefined, recent: recent || undefined },
        ctrl.signal,
      );
      this.updateLesson((x) => ({ ...x, quiz }), "now");
      this.set({ quizLoading: false });
    } catch (e) {
      if ((e as Error).name !== "AbortError") this.set({ quizLoading: false, quizError: e instanceof Error ? e.message : "Couldn't make questions." });
    } finally {
      this.aborts.delete(ctrl);
    }
  }

  // --- playback ---------------------------------------------------------------

  private clearCurrent() {
    this.speech?.cancel();
    this.speech = null;
    this.timers.forEach((t) => t.finish());
    this.timers = [];
  }

  private beatItems(t: TimelineBeat): BoardItem[] {
    const card: BoardItem[] = t.qa?.first ? [{ type: "text", tone: "question", text: t.qa.question }] : [];
    return [...card, ...t.beat.draw];
  }

  play() {
    const s = this.state;
    if (s.phase === "playing") return;
    this.set({ viewSection: null, notice: null });
    if (s.phase === "paused" && this.speech) {
      this.set({ phase: "playing" });
      this.speech.resume();
      this.timers.forEach((t) => t.resume());
      return;
    }
    if (s.phase === "paused" && s.beatStarted && !this.speech && this.timers.length) {
      // Paused in the short gap between beats.
      this.set({ phase: "playing" });
      this.timers.forEach((t) => t.resume());
      return;
    }
    let index = s.index;
    if (s.phase === "ended" || (index >= s.timeline.length && !isGenerating(s.lesson))) index = 0;
    if (index < s.timeline.length) void this.runBeat(index);
    else this.set({ index, phase: "buffering" });
  }

  pause() {
    const s = this.state;
    if (s.phase !== "playing" && s.phase !== "buffering") return;
    this.speech?.pause();
    this.timers.forEach((t) => t.pause());
    this.set({ phase: "paused" });
  }

  toggle() {
    const p = this.state.phase;
    if (p === "playing" || p === "buffering") this.pause();
    else this.play();
  }

  private async runBeat(i: number) {
    const run = ++this.runId;
    this.clearCurrent();
    const t = this.state.timeline[i];
    if (!t) return;
    const rate = this.state.rate;
    const say = speakable(t.beat.say);
    const items = this.beatItems(t);
    this.set({ index: i, phase: "playing", beatStarted: false, timings: null, caption: "", pointed: null, viewSection: null });

    let speechMs = say ? estimateSpeechMs(say, rate) : 0;
    if (this.state.voiceOn && say && this.speaker.kind === "cloud") {
      const real = await this.speaker.prepare(say);
      if (run !== this.runId) return;
      if (real) speechMs = real / rate;
    }
    // Fetch the next beat's audio while this one plays, so there's no gap.
    const nextBeat = this.state.timeline[i + 1];
    if (nextBeat && this.state.voiceOn && this.speaker.kind === "cloud") void this.speaker.prepare(speakable(nextBeat.beat.say));

    const timings = allocateTimings(items, drawBudgetMs(items, speechMs, rate));
    const last = timings[timings.length - 1];
    const drawMs = last ? last.start + last.dur : 0;
    this.set({
      beatStarted: true,
      timings,
      pointed: t.beat.point ?? null,
      replays: { ...this.state.replays, [t.key]: (this.state.replays[t.key] ?? 0) + 1 },
    });

    const onSentence = (_: number, sentence: string) => run === this.runId && this.set({ caption: sentence });
    const speech = !say
      ? silentSpeak("", { rate })
      : this.state.voiceOn
        ? this.speaker.speak(say, { rate, onSentence })
        : silentSpeak(say, { rate, onSentence });
    const draw = new PausableTimer(drawMs);
    this.speech = speech;
    this.timers = [draw];
    if (this.state.phase === "paused") {
      speech.pause();
      draw.pause();
    }
    await Promise.all([speech.done, draw.promise]);
    if (run !== this.runId) return;
    this.speech = null;
    const gap = new PausableTimer(420 / rate, this.state.phase === "paused");
    this.timers = [gap];
    await gap.promise;
    if (run !== this.runId) return;
    this.timers = [];
    this.finishBeat(i);
  }

  private isLastBeatOfQa(t: TimelineBeat): boolean {
    if (!t.qa) return false;
    const q = this.state.lesson.qa.find((x) => x.id === t.qa!.id);
    return !!q && t.key === `qa:${q.id}:${q.beats.length - 1}`;
  }

  private finishBeat(i: number) {
    const t = this.state.timeline[i];
    const next = i + 1;
    const base = { index: next, beatStarted: false, timings: null, pointed: null } as const;
    if (t?.qa && this.waitQa === t.qa.id && this.isLastBeatOfQa(t)) {
      // The answer is still streaming: wait for its next beat.
      this.set({ ...base, phase: "buffering" });
      return;
    }
    if (t?.qa && this.stopAfterQa === t.qa.id && this.isLastBeatOfQa(t)) {
      this.stopAfterQa = null;
      this.set({ ...base, phase: "paused", caption: "" });
      this.scheduleSave();
      return;
    }
    this.set(base);
    this.scheduleSave();
    if (next < this.state.timeline.length) void this.runBeat(next);
    else if (isGenerating(this.state.lesson)) this.set({ phase: "buffering" });
    else this.set({ phase: "ended", caption: "" });
  }

  /** Called whenever the timeline grows: continue if we were waiting for content. */
  private maybeLeaveBuffering() {
    const s = this.state;
    if (s.phase !== "buffering") return;
    const t = s.timeline[s.index];
    if (t) {
      // While an answer streams, only its own beats may play next.
      if (this.waitQa && t.qa?.id !== this.waitQa) return;
      void this.runBeat(s.index);
    } else if (!isGenerating(s.lesson)) {
      this.set({ phase: s.timeline.length ? "ended" : "idle" });
    }
  }

  seek(i: number) {
    const s = this.state;
    const wasPlaying = s.phase === "playing" || s.phase === "buffering";
    this.runId++;
    this.clearCurrent();
    this.speaker.stop();
    const index = Math.max(0, Math.min(i, s.timeline.length));
    this.set({ index, beatStarted: false, timings: null, pointed: null, caption: "", viewSection: null });
    this.scheduleSave();
    if (wasPlaying) {
      if (index < s.timeline.length) void this.runBeat(index);
      else this.set({ phase: isGenerating(s.lesson) ? "buffering" : "ended" });
    } else {
      this.set({ phase: index >= s.timeline.length && !isGenerating(s.lesson) && s.timeline.length ? "ended" : "paused" });
    }
  }

  next() {
    this.seek(this.state.index + 1);
  }
  prev() {
    this.seek(this.state.index - 1);
  }
  repeat() {
    const s = this.state;
    const i = s.beatStarted ? s.index : Math.max(0, s.index - 1);
    const playing = s.phase === "playing" || s.phase === "buffering";
    this.seek(i);
    if (!playing) this.play();
  }

  jumpToSection(sectionIndex: number) {
    const idx = this.state.timeline.findIndex((t) => t.sectionIndex === sectionIndex && !t.qa);
    if (idx < 0) {
      this.set({ notice: "That part is still being prepared." });
      return;
    }
    this.seek(idx);
  }

  viewPage(sectionId: string | null) {
    this.set({ viewSection: sectionId });
  }

  setRate(rate: number) {
    this.set({ rate });
  }

  setVoiceOn(on: boolean) {
    this.set({ voiceOn: on });
    // Muting takes effect immediately; the beat then finishes on the drawing's clock.
    if (!on && this.speech) {
      this.speech.cancel();
      this.speaker.stop();
    }
  }

  dismissNotice() {
    this.set({ notice: null });
  }

  setInk(sectionId: string, strokes: Stroke[]) {
    this.updateLesson((x) => ({ ...x, ink: { ...x.ink, [sectionId]: strokes } }));
  }

  // --- voice interruption -------------------------------------------------------

  /** The student pressed the mic: the teacher stops to listen. */
  startListening() {
    const p = this.state.phase;
    this.resumeAfterMic = p === "playing" || p === "buffering";
    if (this.resumeAfterMic) this.pause();
    this.set({ mic: "listening", interim: "" });
  }

  setInterim(text: string) {
    this.set({ interim: text });
  }

  /** Listening ended with what was heard (or nothing). */
  stopListening(text: string | null) {
    this.set({ mic: "off", interim: "" });
    const wasPlaying = this.resumeAfterMic;
    this.resumeAfterMic = false;
    if (text?.trim()) this.handleUtterance(text.trim(), wasPlaying);
    else if (wasPlaying) this.play();
  }

  /** Voice commands are handled locally; anything else is a question for the teacher. */
  handleUtterance(text: string, wasPlaying: boolean) {
    const t = text.toLowerCase().replace(/[.!?,]+$/g, "").trim();
    const words = t.split(/\s+/).length;
    const short = words <= 6;
    if (short && /^(pause|stop|wait|hold on|ruko|ruk jao)\b/.test(t)) return this.pause();
    if (short && /^(resume|continue|go on|carry on|play|start|chalo|aage)/.test(t)) return this.play();
    if (short && /(repeat|say that again|once more|phir se|dobara)/.test(t)) return this.repeat();
    if (short && /^(next|skip)\b/.test(t)) {
      this.next();
      if (wasPlaying) this.play();
      return;
    }
    if (short && /(slow(er)?( down)?|dheere)/.test(t)) {
      this.setRate(Math.max(0.6, +(this.state.rate - 0.2).toFixed(2)));
      if (wasPlaying) this.play();
      return;
    }
    if (short && /(fast(er)?|speed up|jaldi)/.test(t)) {
      this.setRate(Math.min(2, +(this.state.rate + 0.2).toFixed(2)));
      if (wasPlaying) this.play();
      return;
    }
    if (/(simpl|easier|easy way|don'?t understand|didn'?t (get|understand)|not clear|confus|samajh nahi|samjha nahi|samjh nahi|explain again)/.test(t)) {
      return void this.ask(text, "simpler", { wasPlaying, onBoard: true });
    }
    if (short && /\bexample\b/.test(t)) return void this.ask(text, "example", { wasPlaying, onBoard: true });
    void this.ask(text, "question", { wasPlaying, onBoard: true });
  }

  // --- questions ----------------------------------------------------------------

  private buildContext(sectionId: string | undefined) {
    const s = this.state;
    const l = s.lesson;
    const upto = s.beatStarted ? s.index : s.index - 1;
    const recent = s.timeline
      .slice(Math.max(0, upto - 5), upto + 1)
      .map((t) => t.beat.say)
      .filter(Boolean)
      .map((x) => x.slice(0, 900));
    const board = sectionId ? summarizeItems(pageItems(s.timeline, sectionId, upto).map((p) => p.item), 4500) : "";
    return {
      topic: l.topic.slice(0, 300),
      title: (l.outline?.title ?? l.topic).slice(0, 200),
      level: l.level,
      language: l.language,
      outline: (l.outline?.sections ?? []).map((x) => x.title.slice(0, 200)),
      currentSection: l.outline?.sections.find((x) => x.id === sectionId)?.title,
      recentNarration: recent,
      board,
      chat: l.chat
        .filter((m) => m.text && !m.error && !m.pending)
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 1400) })),
    };
  }

  /** The answer finished streaming: carry on with the lesson, or stop if it was paused when asked. */
  private answerComplete(qaId: string) {
    if (this.waitQa === qaId) this.waitQa = null;
    const s = this.state;
    const prev = s.timeline[s.index - 1];
    const answerFullyPlayed = !!prev?.qa && prev.qa.id === qaId && this.isLastBeatOfQa(prev);
    if (s.phase === "buffering" && answerFullyPlayed && this.stopAfterQa === qaId) {
      this.stopAfterQa = null;
      this.set({ phase: "paused", caption: "" });
      return;
    }
    this.maybeLeaveBuffering();
  }

  async ask(
    question: string,
    mode: AskMode,
    opts: { wasPlaying?: boolean; onBoard?: boolean; about?: { key: string; summary: string } } = {},
  ) {
    const s = this.state;
    const l = s.lesson;
    const onBoard = opts.onBoard ?? this.env.settings.answerOnBoard;
    const label =
      question.trim() ||
      (mode === "simpler" ? "Can you explain that more simply?" : mode === "example" ? "Can you show another example?" : "Can you explain this?");
    const userMsg: ChatMessage = { id: newId("m"), role: "user", text: label, about: opts.about?.summary, createdAt: Date.now() };

    if (!this.env.llm) {
      this.updateLesson((x) => ({
        ...x,
        chat: [
          ...x.chat,
          userMsg,
          {
            id: newId("m"),
            role: "teacher",
            text: "I need an AI provider to answer new questions. Add LLM_PROVIDER and LLM_API_KEY to .env.local and restart the server.",
            error: true,
            createdAt: Date.now(),
          },
        ],
      }));
      return;
    }
    if (!l.outline) return;

    const wasPlaying = opts.wasPlaying ?? (s.phase === "playing" || s.phase === "buffering");
    const anchorIdx = s.beatStarted ? s.index : s.index - 1;
    const anchor = s.timeline[anchorIdx];
    const sectionId = (onBoard ? anchor?.sectionId : this.currentSectionId()) ?? l.outline.sections[0].id;
    const context = this.buildContext(sectionId);
    const qa: QaEntry = {
      id: newId("q"),
      afterKey: anchor?.key ?? START_KEY,
      sectionId,
      question: label,
      mode,
      beats: [],
      status: "loading",
      createdAt: Date.now(),
    };
    const teacherMsg: ChatMessage = { id: newId("m"), role: "teacher", text: "", qaId: onBoard ? qa.id : undefined, pending: true, createdAt: Date.now() };

    if (onBoard) {
      // Stop mid-beat; the answer plays right after it, then the lesson resumes.
      this.runId++;
      this.clearCurrent();
      this.speaker.stop();
      this.waitQa = qa.id;
      this.stopAfterQa = wasPlaying ? null : qa.id;
      this.set({ index: anchorIdx + 1, beatStarted: false, timings: null, pointed: null, phase: "buffering", caption: "", viewSection: null });
      this.updateLesson((x) => ({ ...x, qa: [...x.qa, qa], chat: [...x.chat, userMsg, teacherMsg] }));
    } else {
      this.updateLesson((x) => ({ ...x, chat: [...x.chat, userMsg, teacherMsg] }));
    }
    this.set({ asking: true });

    const beats: QaEntry["beats"] = [];
    const patch = (status: QaEntry["status"], error?: string) => {
      const text = beats.map((b) => b.say).filter(Boolean).join(" ");
      this.updateLesson((x) => ({
        ...x,
        qa: onBoard ? x.qa.map((q) => (q.id === qa.id ? { ...q, beats: [...beats], status, error } : q)) : x.qa,
        chat: x.chat.map((m) =>
          m.id === teacherMsg.id
            ? { ...m, text: error && !text ? error : text || "(answered on the board)", beats: onBoard ? undefined : [...beats], pending: status === "loading", error: !!error && !text }
            : m,
        ),
      }));
    };

    const ctrl = this.track();
    try {
      await streamNdjson(
        "/api/ask",
        { context, question: question.slice(0, 1000), mode: opts.about ? "about" : mode, about: opts.about?.summary },
        (ev) => {
          if (ev.type !== "beat") return;
          beats.push(ev.beat as (typeof beats)[number]);
          patch("loading");
        },
        ctrl.signal,
      );
      if (!beats.length) throw new ApiError("I couldn't come up with an answer. Try asking another way?");
      patch("ready");
      this.answerComplete(qa.id);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const message = e instanceof Error ? e.message : "Something went wrong.";
      if (onBoard && !beats.length) {
        this.waitQa = null;
        // Nothing to show: drop the empty answer and put the lesson back as it was.
        this.updateLesson((x) => ({
          ...x,
          qa: x.qa.filter((q) => q.id !== qa.id),
          chat: x.chat.map((m) => (m.id === teacherMsg.id ? { ...m, text: message, pending: false, error: true } : m)),
        }));
        this.stopAfterQa = null;
        if (wasPlaying) this.maybeLeaveBuffering();
        else this.set({ phase: "paused" });
      } else {
        patch(beats.length ? "ready" : "error", message);
        this.answerComplete(qa.id);
      }
    } finally {
      this.aborts.delete(ctrl);
      this.set({ asking: false });
      this.scheduleSave();
    }
  }
}
