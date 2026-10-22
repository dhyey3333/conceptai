import type { Beat } from "@/lib/board/schema";
import type { Quiz } from "@/lib/quiz/schema";
import type { ResearchPref, Tier, TierPref } from "./routing";

export type { ResearchPref, Tier, TierPref };

export type Level = "school" | "senior" | "college" | "advanced";
export type Language = "english" | "hinglish" | "hindi";
/** "full": every page of the attached material, as many parts as it takes. */
export type Depth = "quick" | "standard" | "deep" | "full";
export type AskMode = "question" | "simpler" | "example" | "about";

export const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: "school", label: "School", hint: "Class 6–10" },
  { value: "senior", label: "Senior / JEE-NEET", hint: "Class 11–12" },
  { value: "college", label: "College", hint: "Undergraduate" },
  { value: "advanced", label: "Advanced", hint: "Postgrad / pro" },
];

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: "english", label: "English" },
  { value: "hinglish", label: "Hinglish" },
  { value: "hindi", label: "हिन्दी" },
];

export const DEPTHS: { value: Depth; label: string; hint: string }[] = [
  { value: "quick", label: "Quick", hint: "~5 min" },
  { value: "standard", label: "Standard", hint: "~12 min" },
  { value: "deep", label: "Deep dive", hint: "~25 min" },
  { value: "full", label: "Whole document", hint: "Every topic in the attached file, part by part" },
];

export interface OutlineSection {
  id: string;
  title: string;
  goal: string;
  /** Pages of the uploaded material this part teaches from, e.g. "12-18". */
  pages?: string;
}

export interface Outline {
  title: string;
  subject: string;
  summary: string;
  objectives: string[];
  sections: OutlineSection[];
}

export interface SectionContent {
  status: "pending" | "loading" | "ready" | "error";
  beats: Beat[];
  error?: string;
  /** "writing" while beats stream in; "checking" once written, while the fact-check runs. */
  phase?: "writing" | "checking";
  /** Interrupted while being written and kept as it was (the outline offers to rewrite it). */
  partial?: boolean;
  /** Whether the fact-check ran, and how many beats it corrected. */
  checked?: boolean;
  fixes?: number;
}

/** A follow-up answer, inserted into the lesson right after the beat it interrupted. */
export interface QaEntry {
  id: string;
  afterKey: string;
  sectionId: string;
  question: string;
  mode: AskMode;
  beats: Beat[];
  status: "loading" | "ready" | "error";
  error?: string;
  /** "correction": the teacher fixing a beat that had already been played. */
  kind?: "correction";
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "teacher";
  text: string;
  qaId?: string;
  about?: string;
  /** Board items of a text-only answer, rendered inside the chat bubble. */
  beats?: Beat[];
  pending?: boolean;
  error?: boolean;
  createdAt: number;
}

export interface Stroke {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  size: number;
  points: [number, number, number][];
}

export interface Source {
  title: string;
  url: string;
}

/** Web research done before planning, passed into every later prompt. */
export interface ResearchState {
  status: "running" | "done" | "skipped" | "error";
  brief?: string;
  sources: Source[];
  queries: string[];
  provider?: "web" | "wikipedia";
  error?: string;
}

export interface Lesson {
  id: string;
  topic: string;
  level: Level;
  language: Language;
  depth: Depth;
  /** Text extracted from an uploaded syllabus/slides, used as the teaching source. */
  sourceText?: string;
  sourceName?: string;
  /** Learner's choice of model ("auto" routes by level) and of web research. */
  tierPref?: TierPref;
  researchPref?: ResearchPref;
  /** Model tier actually teaching this lesson, decided when it was planned. */
  tier?: Tier;
  model?: string;
  difficulty?: string;
  research?: ResearchState;
  status: "new" | "outlining" | "ready" | "error";
  error?: string;
  outline?: Outline;
  sections: Record<string, SectionContent>;
  qa: QaEntry[];
  chat: ChatMessage[];
  /** User drawings, one layer per board page (section id). */
  ink: Record<string, Stroke[]>;
  progress: { index: number };
  quiz?: Quiz;
  /** false: the quiz's answer key hasn't been fact-checked yet (it will be, once the checker is available). */
  quizChecked?: boolean;
  noteId?: string;
  sample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LessonMeta {
  id: string;
  title: string;
  topic: string;
  subject?: string;
  updatedAt: number;
  sample?: boolean;
}

export interface Note {
  id: string;
  title: string;
  topic: string;
  level: Level;
  marks: number[];
  content: string;
  lessonId?: string;
  sources?: { name: string; chars: number }[];
  /** Kept so the notes can be regenerated with the same context. */
  sourceText?: string;
  outline?: string;
  research?: string;
  references?: Source[];
  tier?: Tier;
  status: "generating" | "ready" | "error";
  error?: string;
  /** false: written while the checker was unavailable; checked automatically later. */
  checked?: boolean;
  fixes?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NoteMeta {
  id: string;
  title: string;
  topic: string;
  updatedAt: number;
  preview: string;
}

export function lessonMeta(l: Lesson): LessonMeta {
  return {
    id: l.id,
    title: l.outline?.title ?? l.topic,
    topic: l.topic,
    subject: l.outline?.subject,
    updatedAt: l.updatedAt,
    sample: l.sample,
  };
}

export function noteMeta(n: Note): NoteMeta {
  return {
    id: n.id,
    title: n.title,
    topic: n.topic,
    updatedAt: n.updatedAt,
    preview: n.content.replace(/[#*_`>$\\-]/g, " ").replace(/\s+/g, " ").slice(0, 140),
  };
}

export function newId(prefix = ""): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return prefix + rand;
}
