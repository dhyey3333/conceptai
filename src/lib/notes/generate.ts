"use client";

import { useEffect, useSyncExternalStore } from "react";
import { postJson, streamNdjson } from "@/lib/api";
import { store } from "@/lib/store";
import type { Level, Note, Source, Tier } from "@/lib/lesson/types";

export interface NoteParams {
  topic: string;
  level: Level;
  marks: number[];
  outline?: string;
  sourceText?: string;
  sourceNames?: string[];
  tier?: Tier;
  research?: string;
  references?: Source[];
}

interface LiveState {
  content: string;
  status: Note["status"];
  error?: string;
  /** Written in full; the fact-check is reading it (it may replace the text with a corrected copy). */
  checking?: boolean;
  /** Why a stand-in model is writing (e.g. the free plan ran out). */
  notice?: string;
  /** Bumped when stored notes change outside the editor (a later fact-check), so open views reload. */
  version?: number;
}

/** Notes being generated right now, shared by every view that shows them. */
const live = new Map<string, LiveState>();
const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<() => void>>();

function emit(id: string) {
  listeners.get(id)?.forEach((l) => l());
}

export function useLiveNote(id: string | undefined): LiveState | undefined {
  return useSyncExternalStore(
    (cb) => {
      if (!id) return () => {};
      const set = listeners.get(id) ?? new Set();
      set.add(cb);
      listeners.set(id, set);
      return () => set.delete(cb);
    },
    () => (id ? live.get(id) : undefined),
    () => undefined,
  );
}

export function isGeneratingNote(id: string): boolean {
  return live.get(id)?.status === "generating";
}

/**
 * A note saved as "generating" whose stream isn't running in this page was
 * interrupted (tab closed or reloaded mid-generation). Report what it really is.
 */
export function settleNote(n: Note): Note {
  if (n.status !== "generating" || isGeneratingNote(n.id)) return n;
  return {
    ...n,
    status: n.content.length > 200 ? "ready" : "error",
    error: "Generation stopped before it finished (the page was closed or reloaded). Use Regenerate to complete it.",
  };
}

export function cancelNote(id: string): void {
  controllers.get(id)?.abort();
}

function titleFrom(md: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return (m?.[1] ?? fallback).replace(/[*_`$]/g, "").trim().slice(0, 120) || fallback;
}

/** Stream exam notes into `note`, saving as it goes. Resolves with the final note. */
export async function generateNote(note: Note, params: NoteParams): Promise<Note> {
  controllers.get(note.id)?.abort();
  const ctrl = new AbortController();
  controllers.set(note.id, ctrl);
  let content = "";
  let notice: string | undefined;
  let checked: boolean | undefined;
  const state: LiveState = { content: "", status: "generating" };
  live.set(note.id, state);
  emit(note.id);
  let current: Note = { ...note, content: "", status: "generating", error: undefined, updatedAt: Date.now() };
  await store.saveNote(current);

  let lastSave = Date.now();
  let lastEmit = 0;
  try {
    await streamNdjson(
      "/api/notes",
      params,
      (ev) => {
        if (ev.type === "done") {
          // Absent when fact-checking is off; false when the checker couldn't run.
          if (typeof ev.checked === "boolean") checked = ev.checked;
          return;
        }
        if (ev.type === "notice") {
          notice = String(ev.message ?? "") || undefined;
          live.set(note.id, { content, status: "generating", notice });
          emit(note.id);
          return;
        }
        if (ev.type === "checking") {
          live.set(note.id, { content, status: "generating", checking: true, notice });
          emit(note.id);
          return;
        }
        if (ev.type === "replace") {
          content = String(ev.text ?? content);
          live.set(note.id, { content, status: "generating", checking: true, notice });
          emit(note.id);
          return;
        }
        if (ev.type !== "text") return;
        content += String(ev.text ?? "");
        const now = Date.now();
        // Re-render at most ~8 times a second; save every few seconds.
        if (now - lastEmit > 120) {
          live.set(note.id, { content, status: "generating", notice });
          emit(note.id);
          lastEmit = now;
        }
        if (now - lastSave > 4000) {
          lastSave = now;
          void store.saveNote({ ...current, content, updatedAt: now }, true);
        }
      },
      ctrl.signal,
    );
    current = { ...current, content, title: titleFrom(content, note.title), status: "ready", checked, updatedAt: Date.now() };
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    current = {
      ...current,
      content,
      status: content.length > 200 ? "ready" : "error",
      error: aborted ? "Generation stopped." : e instanceof Error ? e.message : "Generation failed.",
      updatedAt: Date.now(),
    };
  } finally {
    controllers.delete(note.id);
  }
  live.set(note.id, { content: current.content, status: current.status, error: current.error });
  emit(note.id);
  await store.saveNote(current);
  return current;
}

// --- fact-checking notes later ---------------------------------------------------

/** Notes open in an editor (edit/split mode or unsaved typing): never changed under the writer's hands. */
const editing = new Set<string>();
const rechecking = new Set<string>();
/** The server has fact-checking turned off (LLM_VERIFY=off): stop asking. */
let recheckOff = false;

export function setEditingNote(id: string, on: boolean): void {
  if (on) editing.add(id);
  else editing.delete(id);
}

/**
 * Fact-check notes that were written while the checker was unavailable (by
 * the local stand-in, or out of quota / offline). Corrections are applied only
 * if nobody is editing the notes and the text hasn't changed meanwhile;
 * otherwise they're checked again next time.
 */
export async function recheckNote(id: string): Promise<void> {
  if (recheckOff || rechecking.has(id) || editing.has(id) || isGeneratingNote(id)) return;
  const note = await store.getNote(id);
  if (!note || note.checked !== false || note.status !== "ready" || !note.content.trim()) return;
  rechecking.add(id);
  try {
    const r = await postJson<{ checked: boolean; disabled?: boolean; content?: string; fixes?: number }>("/api/check", {
      kind: "notes",
      topic: note.topic,
      level: note.level,
      tier: note.tier,
      research: note.research,
      content: note.content,
    });
    if (r.disabled) {
      recheckOff = true;
      return;
    }
    if (!r.checked) return;
    const now = await store.getNote(id);
    if (!now || now.content !== note.content || editing.has(id)) return;
    const next: Note = { ...now, content: r.content ?? now.content, checked: true, fixes: (now.fixes ?? 0) + (r.fixes ?? 0), updatedAt: Date.now() };
    await store.saveNote(next);
    live.set(id, { content: next.content, status: "ready", version: (live.get(id)?.version ?? 0) + 1 });
    emit(id);
  } catch {
    // Offline or failing: try again next time.
  } finally {
    rechecking.delete(id);
  }
}

/** While notes are on screen, check them once soon and then every few minutes until they're checked. */
export function useNoteRecheck(id: string | undefined): void {
  useEffect(() => {
    if (!id) return;
    const soon = setTimeout(() => void recheckNote(id), 5000);
    const every = setInterval(() => void recheckNote(id), 5 * 60_000);
    return () => {
      clearTimeout(soon);
      clearInterval(every);
    };
  }, [id]);
}
