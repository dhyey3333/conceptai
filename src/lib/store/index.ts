/**
 * Persistence for lessons and notes.
 *
 * Default: this browser's IndexedDB (no setup, private to the device).
 * When NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are set, records go to Supabase
 * under an anonymous auth user (row-level security keeps them private), with
 * IndexedDB as an automatic fallback if Supabase is unreachable.
 */
import { createStore, del, get, set, values, type UseStore } from "idb-keyval";
import { lessonMeta, noteMeta, type Lesson, type LessonMeta, type Note, type NoteMeta } from "@/lib/lesson/types";
import { supabaseBackend } from "./supabase";

export interface Backend {
  name: "local" | "supabase";
  listLessons(): Promise<LessonMeta[]>;
  getLesson(id: string): Promise<Lesson | undefined>;
  saveLesson(l: Lesson): Promise<void>;
  deleteLesson(id: string): Promise<void>;
  listNotes(): Promise<NoteMeta[]>;
  allNotes(): Promise<Note[]>;
  getNote(id: string): Promise<Note | undefined>;
  saveNote(n: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
}

let lessonsDb: UseStore | null = null;
let notesDb: UseStore | null = null;
const lessonsStore = () => (lessonsDb ??= createStore("conceptai-lessons", "lessons"));
const notesStore = () => (notesDb ??= createStore("conceptai-notes", "notes"));

const byRecent = <T extends { updatedAt: number }>(a: T, b: T) => b.updatedAt - a.updatedAt;

export const localBackend: Backend = {
  name: "local",
  async listLessons() {
    return ((await values<Lesson>(lessonsStore())) ?? []).map(lessonMeta).sort(byRecent);
  },
  getLesson: (id) => get<Lesson>(id, lessonsStore()),
  saveLesson: (l) => set(l.id, l, lessonsStore()),
  deleteLesson: (id) => del(id, lessonsStore()),
  async listNotes() {
    return ((await values<Note>(notesStore())) ?? []).map(noteMeta).sort(byRecent);
  },
  async allNotes() {
    return ((await values<Note>(notesStore())) ?? []).sort(byRecent);
  },
  getNote: (id) => get<Note>(id, notesStore()),
  saveNote: (n) => set(n.id, n, notesStore()),
  deleteNote: (id) => del(id, notesStore()),
};

let backendPromise: Promise<Backend> | null = null;

export function backend(): Promise<Backend> {
  backendPromise ??= (async () => {
    const remote = await supabaseBackend().catch((e) => {
      console.warn("[conceptai] Supabase unavailable, using local storage", e);
      return null;
    });
    return remote ?? localBackend;
  })();
  return backendPromise;
}

// --- change notifications (sidebar, lists) ---------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
export function onStoreChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => fn());
}

// --- public API ----------------------------------------------------------------

/** Run on the remote backend; if it fails, fall back to local so nothing is lost. */
async function withFallback<T>(fn: (b: Backend) => Promise<T>): Promise<T> {
  const b = await backend();
  try {
    return await fn(b);
  } catch (e) {
    if (b === localBackend) throw e;
    console.warn("[conceptai] remote storage failed, using local", e);
    return fn(localBackend);
  }
}

export const store = {
  listLessons: () => withFallback((b) => b.listLessons()),
  getLesson: async (id: string) => (await withFallback((b) => b.getLesson(id))) ?? (await localBackend.getLesson(id)),
  async saveLesson(l: Lesson, quiet = false) {
    await withFallback((b) => b.saveLesson(l));
    if (!quiet) notify();
  },
  async deleteLesson(id: string) {
    await withFallback((b) => b.deleteLesson(id));
    notify();
  },
  listNotes: () => withFallback((b) => b.listNotes()),
  allNotes: () => withFallback((b) => b.allNotes()),
  getNote: async (id: string) => (await withFallback((b) => b.getNote(id))) ?? (await localBackend.getNote(id)),
  async saveNote(n: Note, quiet = false) {
    await withFallback((b) => b.saveNote(n));
    if (!quiet) notify();
  },
  async deleteNote(id: string) {
    await withFallback((b) => b.deleteNote(id));
    notify();
  },
  notify,
  backendName: async () => (await backend()).name,
};
