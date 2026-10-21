import { afterEach, describe, expect, it } from "vitest";
import { chooseTier, escalateTier, shouldResearch } from "@/lib/lesson/routing";
import { llmConfig, researchMode } from "@/lib/server/env";
import { collectSources, dedupeSources, webSearchTool, wikiUrl } from "@/lib/server/research";
import type Anthropic from "@anthropic-ai/sdk";

describe("routing", () => {
  it("sends school topics to the fast model and college+ to the best", () => {
    expect(chooseTier("auto", "school")).toBe("fast");
    expect(chooseTier("auto", "senior")).toBe("fast");
    expect(chooseTier("auto", "college")).toBe("best");
    expect(chooseTier("auto", "advanced")).toBe("best");
    expect(chooseTier(undefined, "advanced")).toBe("best");
  });

  it("respects an explicit choice", () => {
    expect(chooseTier("best", "school")).toBe("best");
    expect(chooseTier("fast", "advanced")).toBe("fast");
  });

  it("escalates automatic choices when the plan says the topic is advanced", () => {
    expect(escalateTier("auto", "fast", "advanced")).toBe("best");
    expect(escalateTier("auto", "fast", "intermediate")).toBe("fast");
    expect(escalateTier("fast", "fast", "advanced")).toBe("fast");
  });

  it("researches college+ topics automatically, or when asked", () => {
    expect(shouldResearch("auto", "school")).toBe(false);
    expect(shouldResearch("auto", "advanced")).toBe(true);
    expect(shouldResearch("on", "school")).toBe(true);
    expect(shouldResearch("off", "advanced")).toBe(false);
  });
});

describe("model tiers from env", () => {
  const saved = { ...process.env };
  const setEnv = (vars: Record<string, string | undefined>) => {
    for (const k of Object.keys(process.env)) if (/^(LLM_|ANTHROPIC_|OPENAI_|OLLAMA_)/.test(k)) delete process.env[k];
    Object.assign(process.env, vars);
  };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults Claude to Opus, with Sonnet for easy topics and web research", () => {
    setEnv({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "test-key" });
    expect(llmConfig("best")?.model).toBe("claude-opus-5-5");
    expect(llmConfig("fast")?.model).toBe("claude-sonnet-5-5");
    expect(researchMode()).toBe("web");
  });

  it("uses one model for both tiers when the main model is already Sonnet", () => {
    setEnv({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "test-key", LLM_MODEL: "claude-sonnet-5-5" });
    expect(llmConfig("fast")?.model).toBe("claude-sonnet-5-5");
  });

  it("lets the fast tier be a different provider", () => {
    setEnv({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "test-key", LLM_FAST_PROVIDER: "ollama", LLM_FAST_MODEL: "qwen3:4b-instruct" });
    expect(llmConfig("fast")).toMatchObject({ provider: "ollama", model: "qwen3:4b-instruct" });
    expect(llmConfig("best")?.provider).toBe("anthropic");
  });

  it("falls back to Wikipedia research for other providers, and can be turned off", () => {
    setEnv({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3:4b-instruct" });
    expect(llmConfig("fast")?.model).toBe("qwen3:4b-instruct");
    expect(researchMode()).toBe("wikipedia");
    setEnv({ LLM_PROVIDER: "ollama", LLM_RESEARCH: "off" });
    expect(researchMode()).toBe("off");
  });

  it("is unconfigured without a Claude key", () => {
    setEnv({ LLM_PROVIDER: "anthropic" });
    expect(llmConfig("best")).toBeNull();
    expect(researchMode()).toBe("off");
  });
});

describe("research helpers", () => {
  it("picks the web search tool version the model supports", () => {
    expect(webSearchTool("claude-opus-5-5").type).toBe("web_search_20260209");
    expect(webSearchTool("claude-sonnet-5-5").type).toBe("web_search_20260209");
    expect(webSearchTool("claude-haiku-5-5").type).toBe("web_search_20250305");
  });

  it("collects the brief and puts cited sources before other results", () => {
    const content = [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "kalman filter" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [
          { type: "web_search_result", url: "https://a.edu/kf", title: "KF notes", encrypted_content: "x", page_age: null },
          { type: "web_search_result", url: "https://b.org/kf", title: "KF review", encrypted_content: "x", page_age: null },
        ],
      },
      { type: "text", text: "The Kalman filter ", citations: null },
      {
        type: "text",
        text: "minimises mean squared error.",
        citations: [{ type: "web_search_result_location", url: "https://b.org/kf", title: "KF review", cited_text: "...", encrypted_index: "i" }],
      },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    const got = collectSources(content);
    expect(got.text).toBe("The Kalman filter minimises mean squared error.");
    expect(dedupeSources([...got.cited, ...got.results]).map((s) => s.url)).toEqual(["https://b.org/kf", "https://a.edu/kf"]);
  });

  it("drops non-http and duplicate sources", () => {
    expect(
      dedupeSources([
        { title: "x", url: "javascript:alert(1)" },
        { title: "a", url: "https://a.com" },
        { title: "a2", url: "https://a.com" },
      ]),
    ).toEqual([{ title: "a", url: "https://a.com" }]);
  });

  it("builds Wikipedia links", () => {
    expect(wikiUrl("Ohm's law")).toBe("https://en.wikipedia.org/wiki/Ohm's_law");
  });
});
