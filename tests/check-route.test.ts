import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The reviewer's reply; the real model is never called.
let verdict = "{}";
vi.mock("@/lib/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm")>()),
  completeText: vi.fn(async () => verdict),
}));

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "openai");
  vi.stubEnv("LLM_BASE_URL", "https://api.example.test/v1");
  vi.stubEnv("LLM_API_KEY", "test-key-not-real");
  vi.stubEnv("LLM_VERIFY", "");
});
afterEach(() => vi.unstubAllEnvs());

async function post(body: object, ip: string) {
  const { POST } = await import("@/app/api/check/route");
  const res = await POST(new Request("http://localhost/api/check", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

const beats = [
  { say: "Start with low = 0 and high = 6.", draw: [] },
  { say: "The middle element is at index 2.", draw: [{ type: "text", text: "mid = 2" }] },
];

describe("checking content again later", () => {
  it("returns validated fixes for a lesson part", async () => {
    verdict = JSON.stringify({ fixes: [{ beat: 1, say: "The middle element is at index 3." }] });
    const r = await post({ kind: "beats", topic: "Binary search", level: "college", context: "Part 2", beats }, "10.1.0.1");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ checked: true, fixes: [{ index: 1, beat: { say: "The middle element is at index 3." } }] });
  });

  it("refuses beats that don't validate, since fix indices would no longer line up", async () => {
    const r = await post({ kind: "beats", topic: "Binary search", level: "college", context: "Part 2", beats: [...beats, { nonsense: true }] }, "10.1.0.2");
    expect(r.status).toBe(400);
  });

  it("corrects a quiz's answer key", async () => {
    verdict = JSON.stringify({ fixes: [{ section: "mcq", index: 0, question: { answer: 0 } }] });
    const quiz = { mcq: [{ q: "Largest in a max-heap?", options: ["Root", "A leaf"], answer: 1, explanation: "x" }], numerical: [], short: [] };
    const r = await post({ kind: "quiz", topic: "Heaps", level: "college", quiz }, "10.1.0.3");
    expect(r.json).toMatchObject({ checked: true, fixes: 1, quiz: { mcq: [{ answer: 0 }] } });
  });

  it("says so when fact-checking is turned off, so the app stops asking", async () => {
    vi.stubEnv("LLM_VERIFY", "off");
    const r = await post({ kind: "notes", topic: "Heaps", level: "college", content: "# Heaps" }, "10.1.0.4");
    expect(r.json).toEqual({ checked: false, disabled: true });
  });
});
