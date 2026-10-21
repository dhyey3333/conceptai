/**
 * Listening to the student.
 *
 * - Server speech-to-text (Whisper-style /api/stt) when configured: record with
 *   MediaRecorder and stop automatically after ~1.4 s of silence, detected
 *   from the microphone level (a simple energy-based voice activity detector).
 * - Otherwise the browser's SpeechRecognition (Chrome, Edge, Safari).
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
}

export interface ListenSession {
  /** Stop listening and submit what was heard. */
  stop(): void;
  /** Stop listening and discard. */
  cancel(): void;
}

export const LANG_CODES = { english: "en-IN", hinglish: "en-IN", hindi: "hi-IN" } as const;

export function startListening(opts: { language: keyof typeof LANG_CODES; useServer: boolean } & ListenCallbacks): ListenSession {
  if (opts.useServer && recorderAvailable()) return recordAndTranscribe(opts);
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

function recordAndTranscribe(opts: { language: keyof typeof LANG_CODES } & ListenCallbacks): ListenSession {
  let stopped = false;
  let cancelled = false;
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
        fd.append("language", opts.language === "hindi" ? "hi" : "");
        const res = await fetch("/api/stt", { method: "POST", body: fd });
        const data = (await res.json()) as { text?: string; message?: string };
        if (!res.ok) throw new Error(data.message ?? "Transcription failed.");
        if (data.text) opts.onFinal(data.text);
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
    stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}
