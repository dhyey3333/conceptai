# ConceptAI

An AI teacher that explains **any concept in any subject** the way a great YouTube / Physics Wallah teacher would: speaking while it writes, draws diagrams, solves equations and builds flowcharts on a live whiteboard. You can interrupt any time by voice or text, and it writes **exam-ready notes** for you while you learn.

![stack](https://img.shields.io/badge/Next.js-16-black) ![ts](https://img.shields.io/badge/TypeScript-5.9-blue) ![tw](https://img.shields.io/badge/Tailwind-4-38bdf8)

## What it does

| | |
|---|---|
| **Live whiteboard teaching** | Type a topic. The teacher plans a lesson, then streams it part by part and starts teaching within seconds. Text is written word by word with a chalk "pen", equations sweep in, figures, graphs and flowcharts are stroke-drawn, all timed to the narration. |
| **Synchronized voice** | Every *beat* (1-3 spoken sentences plus what gets drawn meanwhile) is spoken while its drawing animates over the same time span. Play, pause, resume, step, repeat, 0.75×–2× speed, captions. AI voice (OpenAI-compatible or ElevenLabs) when configured, otherwise the browser's voices. |
| **Interrupt and ask** | Press **M** or the mic and just ask ("why is it squared?", "explain simpler", "samajh nahi aaya"). The teacher stops mid-sentence, answers **on the board** (with drawings) and by voice, then carries on. Voice commands: pause, continue, repeat, next, slower, faster. Select anything on the board and "Ask about this". |
| **Your own pen** | Pen, highlighter, eraser, undo/redo, zoom, follow-the-teacher. Ink is saved per board page. |
| **Exam notes** | Definitions, detailed explanation, formulas, derivations, diagrams (Mermaid + whiteboard figures/graphs), worked examples, applications, common mistakes, a revision summary and model answers for **2, 5, 10 and 15 marks**. Generated alongside a lesson or on their own, from a topic or from your **syllabus, PDFs, slides (PPTX) or Word files**. Edit (Markdown + live preview), search, export **Markdown** or **PDF**. |
| **Practice** | MCQs with explanations, numerical problems checked with tolerance plus step-by-step solutions, short-answer questions with model answers. |
| **Memory** | Each lesson keeps its outline, everything said and drawn, your questions and answers, ink, quiz and notes. Follow-ups use that context. Saved in IndexedDB, or Supabase when configured. |
| **Languages & levels** | English, Hinglish, Hindi narration; School, JEE/NEET, College, Advanced; Quick / Standard / Deep dive. |

Three built-in **sample lessons** (Pythagoras, Newton's 2nd law, Photosynthesis) work with no API key at all.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in an LLM provider (see below)
npm run dev                  # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm test` (unit tests), `npm run typecheck`.

Requires Node 20.9+.

### Run it like an app (Windows, no terminal)

Run `npm run shortcuts` once. It puts a **ConceptAI** icon on the Desktop and in the Start menu, plus **Stop ConceptAI** in the Start menu. Double-clicking the icon:

- opens the app at http://localhost:3100 if it's already running (instant);
- otherwise starts it in the background in production mode and shows a "Starting ConceptAI…" page that turns into the app as soon as it answers (about 2 s);
- if the code changed since the last build, rebuilds it first (about 30 s), so the icon always runs the latest version.

`npm run shortcuts -- -StartWithWindows` also starts it in the background when you sign in (`-NoStartWithWindows` undoes that, `-Remove` removes all the shortcuts). The same launcher works anywhere: `npm run launch`, `npm run stop`. Its logs are in `logs/` (`build.log` if a build failed, `server.log` for the running app).

### Python tools (exact maths, real algorithm runs, lesson code, OCR)

The `python/` folder is a small local service (FastAPI, SymPy, PyMuPDF, RapidOCR) that the server starts by itself if [uv](https://docs.astral.sh/uv/) is installed; without it, these features are skipped and everything else works.

- **Exact maths.** Every fact-check first sends the part's equations and derivation steps to SymPy. Wherever two sides are numbers they must agree (allowing for the rounding shown), and a line that continues `= …` must equal the line before; what it finds is passed to the checker as certain errors. LaTeX is converted into a restricted expression language and validated before SymPy sees it, so no equation is ever executed as code.
- **Real algorithm runs.** A lesson part about heap, bubble, selection, insertion, merge or quick sort, binary or linear search, BFS, DFS or Euclid's GCD gets an actual run of the algorithm as its worked example, and the fact-check holds the part to it.
- **Code on the board, really run.** Programming lessons (data structures, algorithms, Python itself) write code on the board as a code block with syntax colours, line by line. Each Python snippet is run as its beat is written, and the board shows what it actually printed, or the error and its line. Snippets in a part run in order like notebook cells, so a class from one beat can be used in a later one. The fact-check gets the real results: code that fails is fixed and run again, and narration that claims a different output is corrected. Python blocks in exam notes are run the same way. The code is written by the AI, so it is treated as untrusted (`python/helper/coderun.py`): only pure-computation imports (collections, heapq, bisect, itertools, functools, math, random, dataclasses, typing and a few more); no files, network, `os` or `sys`; no reaching into Python's internals; a separate process with a 5-second limit, an empty temporary folder and no API keys in its environment (the helper itself gets none either). `PY_RUN_CODE=off` turns it off.
- **OCR.** PDF pages with no text layer (scans, photos) are read with RapidOCR.
- **A natural offline voice.** [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) (Apache-2.0 model, MIT runtime) speaks the narration on this computer, free and with no API key. The helper downloads it once (about 120 MB, into `python/models/`) in the background when it starts, resuming if the connection drops; until it is there, lessons use the browser voice. Once it is, "AI voice" in the voice settings uses it (a cloud voice set with `TTS_PROVIDER` takes priority). Hindi lessons use a Hindi voice; `PY_TTS_VOICE` picks another English one; `PY_TTS=off` turns it off.
- **Lesson videos.** The clapperboard button in a lesson (once every part is written) makes an MP4 of the whole lesson: the whiteboard drawing as it happens, captions, and the offline voice. The helper speaks every beat, then records the app's `/render/<job>` page in headless Chromium (Playwright) while it plays the lesson with exactly those timings, places each voice clip where its beat started, and encodes with ffmpeg (`python/helper/video.py`). Recording is real time, so a 10-minute lesson takes about 10 minutes; one video at a time, kept for an hour.

Tests: `cd python && uv run --group dev pytest`. Quality measurement (with and without these tools, the app must be running): `node eval/quality.mjs`, results in `eval/results/`.

## Configuration

All keys are read **only on the server** (`src/lib/server/env.ts`). The browser only ever learns *whether* something is configured (`GET /api/status`).

### LLM (needed for new topics, answers, notes, quizzes)

| Provider | `.env.local` |
|---|---|
| **Claude** (official Anthropic SDK; default model `claude-opus-5-5`) | `LLM_PROVIDER=anthropic`<br>`LLM_API_KEY=sk-ant-...` |
| **Ollama** (local, free) | `LLM_PROVIDER=ollama`<br>`LLM_MODEL=qwen3-vl:4b-instruct` (or any model you've pulled)<br>`OLLAMA_NUM_CTX=8192` (optional; keep it small on 4-8 GB GPUs so the model stays on the GPU) |
| **Groq** (free tier) | `LLM_PROVIDER=openai`<br>`LLM_BASE_URL=https://api.groq.com/openai/v1`<br>`LLM_API_KEY=gsk_...`<br>`LLM_MODEL=openai/gpt-oss-120b`<br>`LLM_JSON_MODE=false`<br>`LLM_TPM_LIMIT=8000`<br>`LLM_REASONING_EFFORT=low`<br>`LLM_VERIFY_MODEL=openai/gpt-oss-20b`<br>`LLM_FALLBACK_MODELS=openai/gpt-oss-20b` |
| **Any other OpenAI-compatible API** (OpenAI, OpenRouter, Together, vLLM, LM Studio) | `LLM_PROVIDER=openai`<br>`LLM_BASE_URL=...`<br>`LLM_API_KEY=...`<br>`LLM_MODEL=...` |

On rate-limited plans set `LLM_TPM_LIMIT` to the plan's tokens-per-minute: each request is sized to fit it, a 429 is retried after the server's `Retry-After`, and lesson parts and notes are generated one at a time instead of in parallel. Groq's free tier also caps tokens per day (about 200K for gpt-oss-120b), so the free plan runs out after a few lessons a day. Limits are per model, so `LLM_VERIFY_MODEL` runs the fact-check on a second model with its own allowance, and `LLM_FALLBACK_MODELS` keeps lessons going on another model when one runs out. Groq's paid Developer tier (pay per token) lifts the daily cap.

**Free and lasting: a chain of providers.** Each free plan has its own allowance, so ConceptAI tries several in order and moves down the chain when one is used up, rate-limited, offline or set up wrong: Gemini (if `GEMINI_API_KEY` is set; free key at aistudio.google.com, with a much larger per-minute budget, so long PDFs fit), then the `LLM_*` provider (e.g. Groq) and its `LLM_FALLBACK_MODELS`, then `LLM_FALLBACK_*`, `LLM_FALLBACK2_*`, `LLM_FALLBACK3_*` (each with `PROVIDER`, `MODEL` as a comma-separated list, `BASE_URL`, `API_KEY`, `TPM_LIMIT`, `REASONING_EFFORT`, `VERIFY_MODEL`). The amount of a PDF sent per request follows the model actually answering: when a request falls back mid-way (say from Gemini to Groq), it is rebuilt with a shorter excerpt for the new model rather than refused as too large. Gemini's free tier allows only about 20 requests a day per model (measured), so list several models in `GEMINI_MODELS`; a model that answers "retry in 17h" is skipped until then. No free plan is guaranteed forever; a local model at the end of the chain is the part that is.

**Never stuck.** Set `LLM_FALLBACK_PROVIDER=ollama` and `LLM_FALLBACK_MODEL` (e.g. `qwen3-vl:4b-instruct`) and the app falls back to a model on your own computer when every hosted model is used up, still rate-limited after two minutes, or unreachable (you're offline). Lessons get slower and less precise but never stop, and the student sees which model is teaching and why. If Ollama isn't running, the app starts it (about 8 s). A wrong API key or model name also falls back, and is shown in red in the sidebar so it gets fixed. Saved lessons, notes and quizzes always replay without any model.

Whatever was taught while the fact-checker was unavailable (by the local model, or out of quota, or offline) is labelled *not fact-checked yet* and checked automatically once the checker is back: when the lesson or notes are opened and every 5 minutes while they're open. Corrections land as usual (said out loud if already heard); notes are never changed while you're editing them, and a corrected quiz question is asked again.

Voice input uses Groq's Whisper when `STT_PROVIDER=groq`. If it fails (limit reached, unreachable), the mic switches to the browser's own speech recognition on the spot and asks the student to repeat, until the limit resets. Browser recognition works in Chrome, Edge and Safari (it is Google's or Apple's online service, so it needs a connection); Firefox has none, so there the student types.

**Fact-checking.** Every lesson part, answer, set of notes and quiz gets a second, examiner-style review that recomputes numbers, re-runs algorithm traces and compares diagrams with the narration. Lesson parts and answers stream to the board straight away; corrections arrive a few seconds later and replace the original before it is played (if it was already played, the teacher says the correction out loud). Quizzes are checked before they are shown. `LLM_VERIFY=off` turns it off.

Claude requests enable Anthropic's server-side refusal **fallbacks** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) so a rare safety decline is retried on the recommended fallback model; set `ANTHROPIC_FALLBACKS=off` if you route through a proxy that rejects it. `ANTHROPIC_EFFORT` (low/medium/high) trades depth for speed.

Without an LLM the app still runs: samples, whiteboard, voice and notes editing work, and generation buttons explain what to configure.

### Model routing and research

ConceptAI is meant to teach *any* concept, from Class 6 science to master's-level engineering, so it uses two model tiers and looks things up when it matters:

| Lesson | Teacher | Research first |
|---|---|---|
| School, Senior / JEE-NEET | fast tier (Claude Sonnet 5.5 by default) | no (unless "Always") |
| College, Advanced | best tier (`LLM_MODEL`, Claude Opus 5.5 by default) | yes |
| Any level whose plan rates the topic "advanced" | escalated to the best tier | as above |

* The learner can override both on the dashboard (Teacher: Auto / fast / best; Research: Auto / Always / Off).
* **Research** with Claude uses Anthropic's server-side web search tool (`web_search_20260209`, up to 4 searches, resumed on `pause_turn`); the briefing and its sources are fed into the plan, every lesson part, follow-up answers, quizzes and the notes (which end with a References section). With other providers it reads Wikipedia instead. `LLM_RESEARCH=off` disables it.
* The fast tier can be a different provider, e.g. local Ollama for school topics and Claude for the rest: `LLM_FAST_PROVIDER=ollama`, `LLM_FAST_MODEL=qwen3:4b-instruct`.
* Claude calls cache the long system prompt (`cache_control`), so every part after the first reads it at the cache rate.

### Optional: AI voice, AI transcription, cloud persistence

| Feature | Variables | Fallback without them |
|---|---|---|
| AI teacher voice | `TTS_PROVIDER=openai` (or `elevenlabs`), `TTS_API_KEY`, optional `TTS_MODEL`, `TTS_VOICE`, `TTS_BASE_URL` | Browser `speechSynthesis` (picks an en-IN / hi-IN voice for Hinglish/Hindi) |
| Speech-to-text | `STT_PROVIDER=groq` (free Whisper; reuses `LLM_API_KEY` when the lesson model is on Groq) or `STT_PROVIDER=openai` + `STT_API_KEY`; optional `STT_BASE_URL`, `STT_MODEL`. The lesson title is sent as Whisper's prompt so technical terms are spelled right; recording stops by itself after ~1.4 s of silence. | Browser `SpeechRecognition` (Chrome, Edge, Safari) |
| Persistence across devices | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; run `supabase/schema.sql` and enable **anonymous sign-ins** | IndexedDB in this browser |

## How it works

```
Topic ─▶ /api/lesson/outline ─▶ outline (3-7 parts)
             │
             ▼  for each part, in order (streamed NDJSON):
        /api/lesson/section ─▶ { say, draw[], point } beats ─▶ validator ─▶ timeline
                                                                     │
       LessonSession (client): for each beat ── speak(say) ─┬─ same duration ─┐
                                                └─ draw(items) ─────────────┘─▶ next beat
       Question / "explain simpler" ─▶ /api/ask ─▶ answer beats spliced in after the current beat
       After part 1 (or the whole lesson on local models) ─▶ /api/notes (streamed Markdown)
```

* **Board language, not code.** The model writes JSON items from a closed vocabulary: `title, heading, text, bullets, math, steps, table, flowchart, figure (line/arrow/rect/circle/ellipse/polygon/curve/arc/point/text), plot`. Every item is validated with Zod (`src/lib/board/schema.ts`): unknown types and fields are dropped, strings are capped and stripped of control characters, coordinates clamped, lists capped. Nothing the model writes is executed:
  * plots use a whitelist expression compiler (`src/lib/board/expr.ts`), no `eval`;
  * LaTeX renders with KaTeX `trust: false` (no `\href`, `\url`, `\includegraphics`);
  * notes Markdown is rendered without raw HTML; Mermaid runs with `securityLevel: "strict"`;
  * figures and flowcharts are laid out by our own code (a small layered layout for flowcharts).
* **Streaming + robust parsing.** Beats are pulled out of the token stream the moment their closing brace arrives (`src/lib/stream/jsonObjects.ts`), so the first words are spoken while the model is still writing. A repair pass fixes the classic LaTeX-in-JSON bug (`"\frac"` is a form feed, `"\theta"` a tab).
* **Sync.** The drawing for a beat is stretched to the speech duration (`src/lib/board/timing.ts`): exact for AI voice (audio is prefetched, so its length is known), estimated for browser voice. Pause freezes speech, timers and CSS animations together.
* **Server safety.** API keys stay server-side; request bodies are validated and size-limited; there is a per-IP rate limit; uploads are size-capped and zip-bomb-guarded; security headers are set in `next.config.ts`.

## Project layout

```
src/app/                 pages (dashboard, /learn/[id], /notes, /notes/[id]) and API routes
src/components/board/    whiteboard: item renderers, ink layer, toolbar
src/components/learn/    teaching workspace: player, outline, chat, practice, notes
src/components/notes/    notes home, editor, Markdown/KaTeX/Mermaid view
src/lib/board/           schema + validator, timing, flowchart layout, expression compiler
src/lib/lesson/          types, timeline, LessonSession (playback + generation), samples
src/lib/server/          env, LLM adapters, prompts, streaming helpers, file extraction
src/lib/voice/           speech synthesis + recognition with fallbacks
src/lib/store/           IndexedDB + optional Supabase persistence
tests/                   unit tests (parser, validator, expressions, timing, layout)
```

## Notes and limits

* PDF export uses the browser's print dialog (choose "Save as PDF"), which keeps equations and diagrams sharp.
* Scanned PDFs: pages with no text layer are read by OCR when the Python tools are running.
* Teaching from your own material: attach a PDF, PPTX, DOCX, TXT or MD (up to 15 MB, about 250 pages of text) with **Teach from my syllabus / PDF / slides**; the topic box is optional then. With **Whole document** (picked automatically when a file is attached) every page is taught: the document is split at its own section headings into parts small enough to be read in full, as many as it takes, and they are written a couple of parts ahead of you. Quick/Standard/Deep give a shorter lesson planned from a page map of the whole document. How much text fits per request depends on the plan (on Groq's free tier about 5,000 characters per part, so a long page range is read in shortened form). Exam notes for a long document are written the same way, block by block with a heading per block, then a revision summary and questions for the whole; if the chain falls back to a smaller model part-way, the pages still to come are re-planned in smaller blocks so they are still covered in full. A part cut short by a lost connection or quota keeps what was written and offers **Rewrite** in the outline.
* Small local models (3-8B) work, but bigger models draw noticeably better diagrams and make fewer factual slips.
* The rate limiter and live-notes registry are in memory (single server instance).
