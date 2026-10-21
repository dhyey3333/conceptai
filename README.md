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

## Configuration

All keys are read **only on the server** (`src/lib/server/env.ts`). The browser only ever learns *whether* something is configured (`GET /api/status`).

### LLM (needed for new topics, answers, notes, quizzes)

| Provider | `.env.local` |
|---|---|
| **Claude** (official Anthropic SDK; default model `claude-opus-5-5`) | `LLM_PROVIDER=anthropic`<br>`LLM_API_KEY=sk-ant-...` |
| **Ollama** (local, free) | `LLM_PROVIDER=ollama`<br>`LLM_MODEL=qwen3-vl:4b-instruct` (or any model you've pulled)<br>`OLLAMA_NUM_CTX=8192` (optional; keep it small on 4-8 GB GPUs so the model stays on the GPU) |
| **Any OpenAI-compatible API** (OpenAI, Groq, OpenRouter, Together, vLLM, LM Studio) | `LLM_PROVIDER=openai`<br>`LLM_BASE_URL=https://api.groq.com/openai/v1`<br>`LLM_API_KEY=...`<br>`LLM_MODEL=llama-3.3-70b-versatile` |

Claude requests enable Anthropic's server-side refusal **fallbacks** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) so a rare safety decline is retried on the recommended fallback model; set `ANTHROPIC_FALLBACKS=off` if you route through a proxy that rejects it. `ANTHROPIC_EFFORT` (low/medium/high) trades depth for speed.

Without an LLM the app still runs: samples, whiteboard, voice and notes editing work, and generation buttons explain what to configure.

### Optional: AI voice, AI transcription, cloud persistence

| Feature | Variables | Fallback without them |
|---|---|---|
| AI teacher voice | `TTS_PROVIDER=openai` (or `elevenlabs`), `TTS_API_KEY`, optional `TTS_MODEL`, `TTS_VOICE`, `TTS_BASE_URL` | Browser `speechSynthesis` (picks an en-IN / hi-IN voice for Hinglish/Hindi) |
| Speech-to-text | `STT_PROVIDER=openai`, `STT_API_KEY`, optional `STT_BASE_URL` (e.g. Groq), `STT_MODEL` | Browser `SpeechRecognition` (Chrome, Edge, Safari) |
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
* Scanned PDFs have no text layer; run OCR first.
* Small local models (3-8B) work, but bigger models draw noticeably better diagrams and make fewer factual slips.
* The rate limiter and live-notes registry are in memory (single server instance).
