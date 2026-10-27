"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { listVoices } from "@/lib/voice/speaker";
import { browserRecognitionAvailable } from "@/lib/voice/listener";
import { updateSettings, useSettings } from "@/lib/settings";
import { Switch } from "@/components/ui";

export function VoiceSettings({ ttsAvailable, sttAvailable }: { ttsAvailable: boolean; sttAvailable: boolean }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => setVoices(listVoices());
    load();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", load);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const useAi = settings.voiceEngine === "ai" && ttsAvailable;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Voice & lesson settings"
        aria-label="Voice and lesson settings"
        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-white/[0.07] hover:text-fg"
      >
        <Settings2 size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 animate-fade-in space-y-4 rounded-2xl border border-line-strong bg-surface-2 p-4 shadow-2xl">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Teacher&apos;s voice</div>
            <div className="flex gap-1.5">
              <button
                disabled={!ttsAvailable}
                onClick={() => updateSettings({ voiceEngine: "ai" })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[13px] ${useAi ? "border-accent/60 bg-accent/15" : "border-line-strong text-muted"} disabled:opacity-40`}
                title={ttsAvailable ? "A natural voice made on the server (offline, or a cloud voice if one is set up)" : "Turns on by itself once the offline voice is downloaded"}
              >
                AI voice
              </button>
              <button
                onClick={() => updateSettings({ voiceEngine: "browser" })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[13px] ${!useAi ? "border-accent/60 bg-accent/15" : "border-line-strong text-muted"}`}
              >
                Browser voice
              </button>
            </div>
            {!ttsAvailable && (
              <p className="mt-1.5 text-[11px] text-subtle">
                The natural offline voice turns on by itself once it has downloaded (about 120 MB, with the Python tools running), or set TTS_PROVIDER + TTS_API_KEY for a cloud voice.
              </p>
            )}
          </div>
          {!useAi && (
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">Browser voice</span>
              <select
                value={settings.browserVoice ?? ""}
                onChange={(e) => updateSettings({ browserVoice: e.target.value || undefined })}
                className="h-9 w-full rounded-lg border border-line-strong bg-surface-3 px-2 text-[13px] text-fg focus:outline-none"
              >
                <option value="">Automatic (best for the lesson language)</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="space-y-2.5 border-t border-line pt-3">
            <Switch checked={settings.autoNotes} onChange={(v) => updateSettings({ autoNotes: v })} label="Write exam notes while I learn" />
            <Switch checked={settings.answerOnBoard} onChange={(v) => updateSettings({ answerOnBoard: v })} label="Answer questions on the board" />
            <Switch checked={settings.captions} onChange={(v) => updateSettings({ captions: v })} label="Show captions" />
          </div>
          <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-subtle">
            Voice input: {sttAvailable ? "AI transcription (server)" : browserRecognitionAvailable() ? "browser speech recognition" : "not supported in this browser, type instead"}.
          </p>
        </div>
      )}
    </div>
  );
}
