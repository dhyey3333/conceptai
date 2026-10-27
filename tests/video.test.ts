import { afterEach, describe, expect, it, vi } from "vitest";

// The Python helper is faked: what is checked is what the app sends it.
vi.mock("@/lib/server/helper", () => ({ BASE: "http://helper.test", helperUp: vi.fn(async () => true), startHelper: vi.fn() }));
const sent: { url: string; body: unknown }[] = [];
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  return Response.json({ id: "0123456789abcdef", state: "waiting", done: 0, total: 2 });
});
afterEach(() => (sent.length = 0));

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/video/route");
  return POST(new Request("http://localhost:3100/api/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
};

describe("starting a lesson video", () => {
  it("sends validated beats, speakable narration, and this app's own address", async () => {
    const res = await post({
      title: "Squares",
      language: "english",
      parts: [
        {
          title: "Idea",
          beats: [
            { say: "The area is $x^2$.", draw: [{ type: "math", latex: "A = x^2" }, { type: "script", src: "evil.js" }] },
            { say: "", draw: [] },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(sent[0].url).toBe("http://helper.test/video/start");
    const body = sent[0].body as { appUrl: string; lesson: { parts: { beats: { say: string; speech: string; draw: { type: string }[] }[] }[] } };
    expect(body.appUrl).toBe("http://127.0.0.1:3100");
    const beats = body.lesson.parts[0].beats;
    // The empty beat is dropped; the unknown item type never reaches the recorder.
    expect(beats).toHaveLength(1);
    expect(beats[0].draw.map((d) => d.type)).toEqual(["math"]);
    // The voice reads maths as words, not "dollar x caret 2".
    expect(beats[0].speech).not.toContain("$");
    expect(beats[0].speech).toMatch(/^The area is x/);
  });

  it("refuses a lesson with nothing to record", async () => {
    const res = await post({ title: "Empty", language: "english", parts: [{ title: "P", beats: [] }] });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("only proxies well-formed video ids", async () => {
    const { GET } = await import("@/app/api/video/[job]/route");
    const bad = await GET(new Request("http://localhost/api/video/x"), { params: Promise.resolve({ job: "../health" }) });
    expect(bad.status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});
