/**
 * Research before teaching.
 *
 * Claude: one request with Anthropic's server-side web search tool. Claude runs
 * a few searches, reads the results and writes a short teacher's briefing;
 * search results and citations give us the source list. Long server-tool turns
 * can stop with stop_reason "pause_turn", which we resume by re-sending the
 * paused assistant turn (no extra user message).
 *
 * Other providers: Wikipedia's public API (no key) supplies the briefing.
 *
 * The briefing is passed into every later prompt for the lesson, so a niche or
 * graduate-level topic is taught from real sources rather than model memory.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Level } from "@/lib/lesson/types";
import { llmConfig, researchMode, type Tier } from "./env";
import { anthropic, claudeError, claudeExtras, LlmError } from "./llm";
import { LEVEL_TEXT } from "./prompts";

export interface Source {
  title: string;
  url: string;
}

export interface Research {
  brief: string;
  sources: Source[];
  provider: "web" | "wikipedia";
}

export type ResearchEvent =
  | { type: "search"; query: string }
  | { type: "source"; source: Source }
  | { type: "done"; research: Research };

const MAX_SOURCES = 8;
const MAX_BRIEF = 7000;
const MAX_CONTINUATIONS = 3;

export async function* runResearch(input: { topic: string; level: Level; tier: Tier }, signal: AbortSignal): AsyncGenerator<ResearchEvent> {
  const mode = researchMode();
  if (mode === "web") yield* claudeResearch(input, signal);
  else if (mode === "wikipedia") yield* wikipediaResearch(input.topic, signal);
}

// ---------------------------------------------------------------------------
// Claude + web search
// ---------------------------------------------------------------------------

/** Dynamic-filtering web search exists on the newer Opus/Sonnet models; others use the basic tool. */
export function webSearchTool(model: string) {
  const dynamic = /opus-(4-[6-9]|5)|sonnet-(4-6|5)|fable|mythos/.test(model);
  return dynamic
    ? ({ type: "web_search_20260209", name: "web_search", max_uses: 4 } as const)
    : ({ type: "web_search_20250305", name: "web_search", max_uses: 4 } as const);
}

function researchPrompt(topic: string, level: Level): { system: string; user: string } {
  return {
    system:
      "You are a meticulous research assistant preparing a briefing for a teacher who is about to teach a live lesson. Accuracy matters more than breadth. Write in English.",
    user: `Topic: ${topic}
Learner: ${LEVEL_TEXT[level]}

Search the web (2 to 4 searches) for authoritative sources: university course pages and lecture notes, textbooks, standards bodies, official documentation, review articles, or Wikipedia for orientation. Then write a briefing of 300 to 600 words in plain text with short headings:
- Core definitions and standard notation
- Key laws, equations, algorithms or mechanisms, with their conditions and units
- Standard results, typical values, or facts a worked example needs
- Common misconceptions and exam pitfalls
- Recent developments, if the field has moved
No preamble and no closing remarks.`,
  };
}

/** Pull sources out of a finished message: cited ones first, then other results. */
export function collectSources(content: Anthropic.Beta.BetaContentBlock[]): { text: string; cited: Source[]; results: Source[] } {
  let text = "";
  const cited: Source[] = [];
  const results: Source[] = [];
  for (const block of content) {
    if (block.type === "text") {
      text += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") cited.push({ title: c.title ?? c.url, url: c.url });
      }
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) results.push({ title: r.title || r.url, url: r.url });
    }
  }
  return { text, cited, results };
}

export function dedupeSources(list: Source[], max = MAX_SOURCES): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of list) {
    if (!/^https?:\/\//i.test(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ title: s.title.slice(0, 200), url: s.url.slice(0, 500) });
    if (out.length >= max) break;
  }
  return out;
}

async function* claudeResearch(input: { topic: string; level: Level; tier: Tier }, signal: AbortSignal): AsyncGenerator<ResearchEvent> {
  // Research runs on the lesson's tier when that is Claude, else on the main (Claude) model.
  const tiered = llmConfig(input.tier);
  const cfg = tiered?.provider === "anthropic" ? tiered : llmConfig("best");
  if (!cfg || cfg.provider !== "anthropic") return;
  const client = anthropic(cfg);
  const { system, user } = researchPrompt(input.topic, input.level);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
  const announced = new Set<string>();
  let brief = "";
  const cited: Source[] = [];
  const results: Source[] = [];

  try {
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const stream = client.beta.messages.stream(
        { model: cfg.model, max_tokens: 6000, system, messages, tools: [webSearchTool(cfg.model)], ...claudeExtras(cfg) },
        { signal },
      );
      // Report each search query and result list as it happens, for the progress UI.
      const kinds: Record<number, string> = {};
      const partial: Record<number, string> = {};
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          kinds[ev.index] = ev.content_block.type;
          const block = ev.content_block;
          if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
            for (const r of block.content) {
              if (announced.has(r.url) || announced.size >= MAX_SOURCES * 2) continue;
              announced.add(r.url);
              yield { type: "source", source: { title: r.title || r.url, url: r.url } };
            }
          }
        } else if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta") {
          partial[ev.index] = (partial[ev.index] ?? "") + ev.delta.partial_json;
        } else if (ev.type === "content_block_stop" && kinds[ev.index] === "server_tool_use") {
          try {
            const q = (JSON.parse(partial[ev.index] ?? "{}") as { query?: string }).query;
            if (q) yield { type: "search", query: q.slice(0, 200) };
          } catch {
            /* partial input we couldn't read; the search still ran */
          }
        }
      }
      const final = await stream.finalMessage();
      const got = collectSources(final.content);
      brief += got.text;
      cited.push(...got.cited);
      results.push(...got.results);
      if (final.stop_reason === "refusal") throw new LlmError("The research request was declined.", 422, "refusal");
      if (final.stop_reason !== "pause_turn") break;
      // Resume the paused server-tool turn: re-send it as the assistant turn, no new user message.
      messages.push({ role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
    }
  } catch (err) {
    throw claudeError(err, cfg);
  }

  const text = brief.trim().slice(0, MAX_BRIEF);
  if (!text) return;
  yield { type: "done", research: { brief: text, sources: dedupeSources([...cited, ...results]), provider: "web" } };
}

// ---------------------------------------------------------------------------
// Wikipedia fallback
// ---------------------------------------------------------------------------

const WIKI = "https://en.wikipedia.org/w/api.php";
// Wikimedia asks API clients to identify themselves.
const WIKI_HEADERS = { "User-Agent": "ConceptAI/0.1 (educational app; https://github.com/dhyey3333/conceptai)" };

async function wikiJson<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const url = `${WIKI}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  const res = await fetch(url, { headers: WIKI_HEADERS, signal });
  if (!res.ok) throw new LlmError(`Wikipedia error ${res.status}.`, 502, "research");
  return (await res.json()) as T;
}

export function wikiUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function* wikipediaResearch(topic: string, signal: AbortSignal): AsyncGenerator<ResearchEvent> {
  yield { type: "search", query: topic };
  const search = await wikiJson<{ query?: { search?: { title: string }[] } }>(
    { action: "query", list: "search", srsearch: topic.slice(0, 200), srlimit: "3" },
    signal,
  );
  const titles = (search.query?.search ?? []).map((r) => r.title).slice(0, 2);
  const parts: string[] = [];
  const sources: Source[] = [];
  for (const title of titles) {
    // Full plain-text extracts are only served one page per request.
    const page = await wikiJson<{ query?: { pages?: { title: string; extract?: string }[] } }>(
      { action: "query", prop: "extracts", explaintext: "1", exsectionformat: "plain", exchars: "4000", redirects: "1", titles: title },
      signal,
    );
    const p = page.query?.pages?.[0];
    if (!p?.extract?.trim()) continue;
    const source = { title: `${p.title} (Wikipedia)`, url: wikiUrl(p.title) };
    sources.push(source);
    yield { type: "source", source };
    parts.push(`## ${p.title}\n${p.extract.trim()}`);
  }
  if (!parts.length) return;
  yield { type: "done", research: { brief: parts.join("\n\n").slice(0, MAX_BRIEF), sources, provider: "wikipedia" } };
}
