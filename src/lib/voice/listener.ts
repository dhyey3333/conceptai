/**
 * Listening to the student.
 *
 * - Server speech-to-text (Whisper-style /api/stt) when configured: record with
 *   MediaRecorder and stop automatically after ~1.4 s of silence, detected
 *   from the microphone level (a simple energy-based voice activity detector).
 * - Otherwise the browser's SpeechRecognition (Chrome, Edge, Safari).
 * - If the server's speech-to-text fails (its limit is reached, or it can't be
 *   reached), switch to the browser's recognition on the spot, ask the student
 *   to say it again, and keep using it until the limit should have reset.
 */

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserRecognitionAvailable(): boolean {
  return !!recognitionCtor();
}

export function recorderAvailable(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface ListenCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
  /** Told when listening switches to the browser's recognition (and why). */
  onNotice?: (message: string) => void;
}

/** Until when the server's speech-to-text is considered unavailable (its limit, or unreachable). */
let serverDownUntil = 0;

/** Why a transcription failure means "use the browser instead": the service, not the recording, failed. */
function serviceDownFor(status: number | null, retryAfterMs?: number): number | null {
  if (status === null || status === 503 || status === 502 || status === 500) return 2 * 60_000;
  if (status === 429) return Math.min(60 * 60_000, Math.max(60_000, retryAfterMs ?? 10 * 60_000));
  return null;
}

export interface ListenSession {
  /** Stop listening and submit what was heard. */
  stop(): void;
  /** Stop listening and discard. */
  cancel(): void;
}

export const LANG_CODES = { english: "en-IN", hinglish: "en-IN", hindi: "hi-IN" } as const;

export function startListening(
  opts: { language: keyof typeof LANG_CODES; useServer: boolean; hint?: string } & ListenCallbacks,
): ListenSession {
  // While the server's speech-to-text is down, use the browser's (if it has one; otherwise try the server anyway).
  if (opts.useServer && recorderAvailable() && (Date.now() >= serverDownUntil || !recognitionCtor())) return recordAndTranscribe(opts);
  return browserRecognition(opts);
}

function browserRecognition(opts: { language: keyof typeof LANG_CODES } & ListenCallbacks): ListenSession {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    opts.onError("Voice input isn't supported in this browser. Type your question instead.");
    opts.onEnd();
    return { stop() {}, cancel() {} };
  }
  const rec = new Ctor();
  rec.lang = LANG_CODES[opts.language];
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let interim = "";
  let cancelled = false;
  rec.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onInterim((finalText + " " + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    opts.onError(
      e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Microphone access was blocked. Allow it in the address bar to talk to the teacher."
        : `Voice input error: ${e.error}`,
    );
  };
  rec.onend = () => {
    const text = (finalText + " " + interim).trim();
    if (!cancelled && text) opts.onFinal(text);
    opts.onEnd();
  };
  try {
    rec.start();
  } catch {
    opts.onError("Couldn't start voice input.");
    opts.onEnd();
  }
  return {
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
  };
}

function recordAndTranscribe(opts: { language: keyof typeof LANG_CODES; hint?: string } & ListenCallbacks): ListenSession {
  let stopped = false;
  let cancelled = false;
  /** The browser's recognition, once it has taken over from a failed server transcription. */
  let fallback: ListenSession | null = null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let raf = 0;
  const chunks: Blob[] = [];

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      cleanup();
      opts.onEnd();
    }
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      opts.onError("Microphone access was blocked. Allow it in the address bar to talk to the teacher.");
      opts.onEnd();
      return;
    }
    if (stopped) {
      cleanup();
      opts.onEnd();
      return;
    }
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      cleanup();
      if (cancelled || !chunks.length) return opts.onEnd();
      opts.onInterim("Transcribing…");
      try {
        const fd = new FormData();
        fd.append("audio", new Blob(chunks, { type: recorder!.mimeType || "audio/webm" }));
        // English is pinned for accuracy; Hinglish is left to auto-detect so mixed speech isn't forced.
        fd.append("language", opts.language === "hindi" ? "hi" : opts.language === "english" ? "en" : "");
        if (opts.hint) fd.append("hint", opts.hint);
        let res: Response | null = null;
        let data: { text?: string; message?: string; retryAfterMs?: number } = {};
        try {
          res = await fetch("/api/stt", { method: "POST", body: fd });
          data = await res.json();
        } catch {
          res = null;
        }
        if (res?.ok) {
          if (data.text) opts.onFinal(data.text);
        } else {
          const downFor = serviceDownFor(res ? res.status : null, data.retryAfterMs);
          // The service failed, not the recording: let the browser listen instead, right away.
          if (downFor && recognitionCtor() && !cancelled) {
            serverDownUntil = Date.now() + downFor;
            opts.onNotice?.("AI speech recognition is unavailable for now, so your browser's is listening instead. Please say that again.");
            opts.onInterim("Please say that again…");
            fallback = browserRecognition(opts);
            return;
          }
          opts.onError(data.message ?? (res ? "Transcription failed." : "Couldn't reach the server to transcribe."));
        }
      } catch (e) {
        opts.onError(e instanceof Error ? e.message : "Transcription failed.");
      }
      opts.onEnd();
    };
    recorder.start(250);
    opts.onInterim("Listening…");

    // Voice activity detection: stop after sustained silence once speech was heard.
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    let heard = false;
    let lastLoud = performance.now();
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > 0.035) {
        heard = true;
        lastLoud = now;
      }
      if ((heard && now - lastLoud > 1400) || (!heard && now - startedAt > 8000) || now - startedAt > 30000) return stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  })();

  return {
    stop: () => (fallback ? fallback.stop() : stop()),
    cancel: () => {
      cancelled = true;
      if (fallback) fallback.cancel();
      else stop();
    },
  };
}
