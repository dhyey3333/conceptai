"use client";

import { useEffect, useState } from "react";
import { onStoreChange, store } from "@/lib/store";
import type { LessonMeta, NoteMeta } from "@/lib/lesson/types";

/** Saved lessons and notes, refreshed whenever anything is saved or deleted. */
export function useLists() {
  const [lessons, setLessons] = useState<LessonMeta[] | null>(null);
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [l, n] = await Promise.all([store.listLessons().catch(() => []), store.listNotes().catch(() => [])]);
      if (alive) {
        setLessons(l);
        setNotes(n);
      }
    };
    void load();
    const off = onStoreChange(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { lessons, notes };
}
