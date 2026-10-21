"use client";

import { useSyncExternalStore } from "react";
import { streamNdjson } from "@/lib/api";
import { store } from "@/lib/store";
import type { Level, Note } from "@/lib/lesson/types";

export interface NoteParams {
  topic: string;
  level: Level;
  marks: number[];
  outline?: string;
  sourceText?: string;
  sourceNames?: string[];
}

interface LiveState {
  content: string;
  status: Note["status"];
  error?: string;
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
        if (ev.type !== "text") return;
        content += String(ev.text ?? "");
        const now = Date.now();
        // Re-render at most ~8 times a second; save every few seconds.
        if (now - lastEmit > 120) {
          live.set(note.id, { content, status: "generating" });
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
    current = { ...current, content, title: titleFrom(content, note.title), status: "ready", updatedAt: Date.now() };
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
