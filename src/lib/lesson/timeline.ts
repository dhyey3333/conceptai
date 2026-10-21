/**
 * The lesson timeline: every beat in playing order.
 *
 * Section beats come in outline order. A follow-up answer is spliced in right
 * after the beat that was playing when the student asked, so the board shows
 * the answer where the question happened and the lesson then carries on.
 * Answers to questions about an answer nest the same way.
 */
import type { Beat, BoardItem } from "@/lib/board/schema";
import type { Lesson, QaEntry } from "./types";

export interface TimelineBeat {
  key: string;
  sectionId: string;
  sectionIndex: number;
  beat: Beat;
  qa?: { id: string; question: string; first: boolean; correction?: boolean };
}

export const START_KEY = "^";

export function buildTimeline(lesson: Lesson): TimelineBeat[] {
  const out: TimelineBeat[] = [];
  const sections = lesson.outline?.sections ?? [];
  const byAnchor = new Map<string, QaEntry[]>();
  for (const q of lesson.qa) {
    if (!q.beats.length) continue;
    const list = byAnchor.get(q.afterKey) ?? [];
    list.push(q);
    byAnchor.set(q.afterKey, list);
  }

  const emitAnswers = (anchor: string, sectionId: string, sectionIndex: number) => {
    for (const q of byAnchor.get(anchor) ?? []) {
      q.beats.forEach((beat, j) => {
        const key = `qa:${q.id}:${j}`;
        out.push({ key, sectionId, sectionIndex, beat, qa: { id: q.id, question: q.question, first: j === 0, correction: q.kind === "correction" } });
        emitAnswers(key, sectionId, sectionIndex);
      });
    }
  };

  if (sections[0]) emitAnswers(START_KEY, sections[0].id, 0);
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    const content = lesson.sections[s.id];
    if (!content) break;
    content.beats.forEach((beat, bi) => {
      const key = `${s.id}:${bi}`;
      out.push({ key, sectionId: s.id, sectionIndex: si, beat });
      emitAnswers(key, s.id, si);
    });
    // Later sections can't play before this one has fully arrived.
    if (content.status !== "ready") break;
  }
  return out;
}

/** Whether more beats may still arrive (a section is pending or streaming). */
export function isGenerating(lesson: Lesson): boolean {
  if (lesson.status === "new" || lesson.status === "outlining") return true;
  const sections = lesson.outline?.sections ?? [];
  return (
    sections.some((s) => {
      const st = lesson.sections[s.id]?.status;
      return st === "pending" || st === "loading";
    }) || lesson.qa.some((q) => q.status === "loading")
  );
}

/** Board item as placed on a page, with a stable key for React and selection. */
export interface PageItem {
  key: string;
  item: BoardItem;
  beatIndex: number;
  qaId?: string;
}

/** Items that belong on a section's board page, from the beats up to `uptoIndex` (inclusive). */
export function pageItems(timeline: TimelineBeat[], sectionId: string, uptoIndex: number): PageItem[] {
  const items: PageItem[] = [];
  const last = Math.min(uptoIndex, timeline.length - 1);
  for (let i = 0; i <= last; i++) {
    const t = timeline[i];
    if (t.sectionId !== sectionId) continue;
    if (t.qa?.first) {
      // A question card heads every answer on the board (a correction gets a correction card).
      items.push({
        key: `${t.key}:q`,
        item: { type: "text", tone: t.qa.correction ? "important" : "question", text: t.qa.question },
        beatIndex: i,
        qaId: t.qa.id,
      });
    }
    t.beat.draw.forEach((item, j) => items.push({ key: `${t.key}:${j}`, item, beatIndex: i, qaId: t.qa?.id }));
  }
  return items;
}
