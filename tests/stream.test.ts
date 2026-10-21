import { describe, expect, it } from "vitest";
import { extractJsonObject, JsonObjectStream, parseLooseJson, repairJsonEscapes } from "@/lib/stream/jsonObjects";

function feed(text: string, chunk = 7): string[] {
  const s = new JsonObjectStream();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunk) out.push(...s.push(text.slice(i, i + chunk)));
  return out;
}

describe("JsonObjectStream", () => {
  it("emits each beat of a {beats:[...]} wrapper as soon as it closes", () => {
    const text = '{"beats":[{"say":"a","draw":[{"type":"text","text":"x"}]},{"say":"b {not a brace}"}]}';
    const s = new JsonObjectStream();
    const first = s.push(text.slice(0, text.indexOf("]},") + 2));
    expect(first).toHaveLength(1);
    expect(JSON.parse(first[0]).say).toBe("a");
    const rest = s.push(text.slice(text.indexOf("]},") + 2));
    expect(rest.map((r) => JSON.parse(r).say)).toEqual(["b {not a brace}"]);
  });

  it("handles NDJSON beats without splitting their draw arrays", () => {
    const text = '{"say":"one","draw":[{"type":"math","latex":"x"}]}\n{"say":"two","draw":[]}\n';
    expect(feed(text).map((o) => JSON.parse(o).say)).toEqual(["one", "two"]);
  });

  it("handles a bare top-level array and code fences", () => {
    const text = '```json\n[{"say":"a"},{"say":"b"}]\n```';
    expect(feed(text, 3).map((o) => JSON.parse(o).say)).toEqual(["a", "b"]);
  });

  it("ignores braces and escaped quotes inside strings", () => {
    const text = '{"beats":[{"say":"he said \\"}{\\" ok"}]}';
    expect(feed(text, 2).map((o) => JSON.parse(o).say)).toEqual(['he said "}{" ok']);
  });
});

describe("repairJsonEscapes", () => {
  it("keeps LaTeX commands that collide with JSON escapes", () => {
    const raw = '{"latex":"\\frac{a}{b} + \\theta + \\nabla + \\beta + \\rho"}';
    const v = parseLooseJson(raw) as { latex: string };
    expect(v.latex).toBe("\\frac{a}{b} + \\theta + \\nabla + \\beta + \\rho");
  });

  it("doubles invalid escapes like \\, and \\{", () => {
    const v = parseLooseJson('{"latex":"a\\,b \\{x\\} 5\\%"}') as { latex: string };
    expect(v.latex).toBe("a\\,b \\{x\\} 5\\%");
  });

  it("leaves correct JSON alone", () => {
    const raw = '{"latex":"\\\\frac{1}{2}","say":"line\\nNext","q":"\\"hi\\"","u":"\\u00e9"}';
    expect(repairJsonEscapes(raw)).toBe(raw);
    expect(parseLooseJson(raw)).toEqual({ latex: "\\frac{1}{2}", say: "line\nNext", q: '"hi"', u: "é" });
  });

  it("tolerates trailing commas", () => {
    expect(parseLooseJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });
});

describe("extractJsonObject", () => {
  it("finds the outer object amid chatter", () => {
    const text = 'Sure! Here is the plan:\n```json\n{"title":"T","sections":[{"title":"A"},{"title":"B"}]}\n```';
    expect(extractJsonObject(text)).toEqual({ title: "T", sections: [{ title: "A" }, { title: "B" }] });
  });
});
