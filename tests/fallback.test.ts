import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FallbackNotice } from "@/lib/server/llm";

// A hosted provider (two models) plus a local Ollama stand-in, all faked: no network is used.
const ENV = {
  LLM_PROVIDER: "openai",
  LLM_BASE_URL: "https://api.example.test/openai/v1",
  LLM_API_KEY: "test-key-not-real",
  LLM_MODEL: "big",
  LLM_FALLBACK_MODELS: "small",
  LLM_FALLBACK_PROVIDER: "ollama",
  LLM_FALLBACK_MODEL: "local",
  LLM_FALLBACK_BASE_URL: "http://localhost:11434",
};

type Behaviour = "ok" | "daily" | "offline" | "badkey";
let hosted: Record<string, Behaviour> = {};
const calls: string[] = [];
const sent: Record<string, string> = {};

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv("LLM_TPM_LIMIT", "");
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.model);
    sent[body.model] = body.messages.at(-1).content;
    if (url.startsWith("http://localhost:11434")) {
      return new Response(`${JSON.stringify({ message: { content: "from local" } })}\n${JSON.stringify({ done: true, done_reason: "stop" })}\n`, { status: 200 });
    }
    const b = hosted[body.model] ?? "ok";
    if (b === "offline") throw new TypeError("fetch failed");
    if (b === "badkey") return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 });
    if (b === "daily")
      return new Response(JSON.stringify({ error: { message: `Rate limit reached for model ${body.model} on tokens per day (TPD): Limit 200000. Please try again in 12m3s.` } }), { status: 429 });
    return sse(`from ${body.model}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function run(opts: { check?: boolean } = {}) {
  const { completeText } = await import("@/lib/server/llm");
  const notices: FallbackNotice[] = [];
  const text = await completeText({ system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 100, onFallback: (n) => notices.push(n), ...opts });
  return { text, notices };
}

describe("falling back when the main model can't answer", () => {
  it("uses the main model when it works", async () => {
    hosted = {};
    expect(await run()).toEqual({ text: "from big", notices: [] });
  });

  it("goes down the chain when daily limits run out, then skips the exhausted models", async () => {
    hosted = { big: "daily", small: "daily" };
    const first = await run();
    expect(first.text).toBe("from local");
    expect(first.notices.map((n) => `${n.from}>${n.to}:${n.reason}:${n.local}`)).toEqual(["big>small:quota:false", "small>local:quota:true"]);
    expect(first.notices[0].minutes).toBe(13);
    calls.length = 0;
    const second = await run();
    expect(calls).toEqual(["local"]);
    expect(second.notices).toMatchObject([{ from: "big", to: "local", reason: "quota", local: true }]);
  });

  it("keeps teaching offline on the local model", async () => {
    hosted = { big: "offline", small: "offline" };
    const r = await run();
    expect(r.text).toBe("from local");
    expect(r.notices[0].reason).toBe("offline");
  });

  it("never hands the fact-check to the local model", async () => {
    hosted = { big: "daily", small: "daily" };
    await expect(run({ check: true })).rejects.toMatchObject({ code: "quota" });
  });

  it("puts Gemini first when its key is set, then the rest of the chain", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-not-real");
    vi.stubEnv("LLM_FALLBACK2_PROVIDER", "openai");
    vi.stubEnv("LLM_FALLBACK2_BASE_URL", "https://other.example.test/v1");
    vi.stubEnv("LLM_FALLBACK2_API_KEY", "test-key-2");
    vi.stubEnv("LLM_FALLBACK2_MODEL", "other-a,other-b");
    const { providerChain } = await import("@/lib/server/env");
    expect(providerChain().flatMap((l) => l.configs.map((c) => c.model))).toEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "big",
      "small",
      "local",
      "other-a",
      "other-b",
    ]);
    hosted = { "gemini-3.8-flash": "daily", "gemini-3.5-flash-lite": "daily" };
    const r = await run();
    expect(r.text).toBe("from big");
    expect(r.notices.map((n) => n.to)).toEqual(["gemini-3.5-flash-lite", "big"]);
  });

  it("checks with each provider's chosen checker, skipping local models", async () => {
    vi.stubEnv("LLM_VERIFY_MODEL", "small");
    hosted = {};
    calls.length = 0;
    expect((await run({ check: true })).text).toBe("from small");
    hosted = { small: "daily", big: "daily" };
    await expect(run({ check: true })).rejects.toMatchObject({ code: "quota" });
    expect(calls).not.toContain("local");
  });

  it("sizes uploaded material for the model that will answer", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-not-real");
    vi.stubEnv("LLM_TPM_LIMIT", "8000");
    const { sourceBudget } = await import("@/lib/server/llm");
    expect(sourceBudget(undefined, "part")).toBe(14000);
    hosted = { "gemini-3.8-flash": "daily", "gemini-3.5-flash-lite": "daily" };
    await run();
    // Gemini is used up, so Groq-like "big" (8,000 tokens a minute) answers: less material fits.
    expect(sourceBudget(undefined, "part")).toBe(5000);
  });

  it("rebuilds the prompt for each model it falls back to, within one request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-not-real");
    vi.stubEnv("LLM_TPM_LIMIT", "8000");
    hosted = { "gemini-3.8-flash": "daily", "gemini-3.5-flash-lite": "daily", big: "daily", small: "daily" };
    const { completeText } = await import("@/lib/server/llm");
    const { budgetFor } = await import("@/lib/server/env");
    const sized = (b: number) => ({ system: "s", messages: [{ role: "user" as const, content: `budget ${b}` }] });
    const text = await completeText({ ...sized(40000), sizeFor: (cfg) => sized(budgetFor(cfg, "notes")), maxTokens: 100 });
    expect(text).toBe("from local");
    // Gemini gets the long excerpt; the Groq-like models (8,000 tokens a minute) and the local model a short one.
    expect([sent["gemini-3.8-flash"], sent.big, sent.small, sent.local]).toEqual(["budget 40000", "budget 9000", "budget 9000", "budget 9000"]);
  });

  it("keeps teaching past a rejected API key, and reports it instead of hiding it", async () => {
    hosted = { big: "badkey", small: "badkey" };
    const r = await run();
    expect(r.text).toBe("from local");
    expect(r.notices[0]).toMatchObject({ reason: "config", detail: "its API key was rejected" });
    const { currentConfigProblem, fallbackMessage } = await import("@/lib/server/llm");
    expect(currentConfigProblem()).toBe("small: its API key was rejected. Fix it in .env.local and restart.");
    expect(fallbackMessage(r.notices[0])).toBe("big can't be used: its API key was rejected. Fix it in .env.local and restart. Meanwhile small is teaching.");
  });

  it("explains the switch in words", async () => {
    const { fallbackMessage } = await import("@/lib/server/llm");
    expect(fallbackMessage({ from: "openai/gpt-oss-120b", to: "qwen3-vl:4b-instruct", reason: "quota", local: true, minutes: 13 })).toBe(
      "openai/gpt-oss-120b has used up its free allowance for now (it frees up in about 13 min). Meanwhile qwen3-vl:4b-instruct is teaching on this computer: slower, and less precise.",
    );
  });
});
