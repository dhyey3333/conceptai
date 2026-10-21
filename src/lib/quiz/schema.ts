/** Practice questions generated from a lesson, validated like board items. */
import { z } from "zod";
import { cleanText } from "@/lib/board/schema";

const text = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => cleanText(String(v), max))
    .pipe(z.string().min(1));

const lenient = <T extends z.ZodTypeAny>(schema: T, max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((arr) =>
      arr
        .map((v) => schema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => r.data as z.output<T>)
        .slice(0, max),
    );

const Mcq = z
  .object({
    q: text(600),
    options: z.array(text(240)).min(2).max(6),
    answer: z.coerce.number().int(),
    explanation: text(1200).catch("No explanation provided."),
  })
  .refine((m) => m.answer >= 0 && m.answer < m.options.length);

const Numerical = z.object({
  q: text(800),
  answer: z.coerce.number().refine((n) => Number.isFinite(n)),
  unit: z.string().max(30).optional().catch(undefined),
  tolerance: z.coerce.number().min(0).max(0.5).optional().catch(undefined),
  solution: z.array(text(400)).min(1).max(12).catch(["Solution not provided."]),
});

const Short = z.object({
  q: text(600),
  marks: z.coerce.number().int().min(1).max(20).optional().catch(undefined),
  answer: text(3000),
});

export const QuizSchema = z.object({
  mcq: lenient(Mcq, 10),
  numerical: lenient(Numerical, 5),
  short: lenient(Short, 6),
});

export type Quiz = z.output<typeof QuizSchema>;
export type McqQuestion = Quiz["mcq"][number];
export type NumericalQuestion = Quiz["numerical"][number];
export type ShortQuestion = Quiz["short"][number];

/** Accepts common model variations (question/choices/correct...) before validating. */
export function sanitizeQuiz(raw: unknown): Quiz | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => r[k]).find(Array.isArray) ?? [];
  const norm = (o: unknown): unknown => {
    if (typeof o !== "object" || o === null) return o;
    const m = { ...(o as Record<string, unknown>) };
    m.q ??= m.question ?? m.prompt;
    m.options ??= m.choices;
    m.explanation ??= m.reason ?? m.why;
    m.solution ??= m.steps;
    if (typeof m.solution === "string") m.solution = [m.solution];
    m.answer ??= m.correct ?? m.correctIndex ?? m.correct_answer ?? m.modelAnswer ?? m.model_answer;
    // Numerical answers often arrive as "6 V" or "2.5 m/s^2": split the number from the unit.
    if (!Array.isArray(m.options) && typeof m.answer === "string" && Array.isArray(m.solution)) {
      const num = /^\s*(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s*(.*)$/.exec(m.answer.replace(/,/g, ""));
      if (num) {
        m.answer = Number(num[1]);
        if (!m.unit && num[2]) m.unit = num[2].replace(/^\$|\$$/g, "").trim().slice(0, 30);
      }
    }
    // MCQ answer given as a letter ("B") or as the option text.
    if (Array.isArray(m.options) && typeof m.answer === "string" && !/^\d+$/.test(m.answer.trim())) {
      const a = m.answer.trim();
      const letter = /^[A-Fa-f]$/.test(a) ? a.toUpperCase().charCodeAt(0) - 65 : -1;
      const idx = letter >= 0 ? letter : (m.options as unknown[]).findIndex((op) => String(op).trim() === a);
      if (idx >= 0) m.answer = idx;
    }
    return m;
  };
  const parsed = QuizSchema.safeParse({
    mcq: pick("mcq", "mcqs", "multipleChoice").map(norm),
    numerical: pick("numerical", "numericals", "problems").map(norm),
    short: pick("short", "shortAnswer", "practice", "questions").map(norm),
  });
  if (!parsed.success) return null;
  const q = parsed.data;
  return q.mcq.length + q.numerical.length + q.short.length > 0 ? q : null;
}
