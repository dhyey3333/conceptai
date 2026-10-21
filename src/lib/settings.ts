"use client";

import { useSyncExternalStore } from "react";

/** Per-device preferences, kept in localStorage (they are conveniences, not data). */
export interface Settings {
  voiceOn: boolean;
  /** "ai" uses the server voice when configured; "browser" always uses the built-in one. */
  voiceEngine: "ai" | "browser";
  browserVoice?: string;
  rate: number;
  captions: boolean;
  autoNotes: boolean;
  answerOnBoard: boolean;
}

const DEFAULTS: Settings = {
  voiceOn: true,
  voiceEngine: "ai",
  rate: 1,
  captions: true,
  autoNotes: true,
  answerOnBoard: true,
};

const KEY = "conceptai.settings.v1";
let current: Settings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Settings {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* private mode etc. */
  }
  return current;
}

export function getSettings(): Settings {
  return typeof window === "undefined" ? DEFAULTS : load();
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSettings,
    () => DEFAULTS,
  );
}
