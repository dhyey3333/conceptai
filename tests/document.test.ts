import { describe, expect, it } from "vitest";
import { documentMap, excerpt, headingsOf, parsePages, splitPages } from "@/lib/source/document";

// A 40-page "module": every page has a heading and some body text; topics change every 10 pages.
const TOPICS = ["Image Formation", "Edge Detection", "Feature Matching", "Optical Flow"];
const doc = Array.from({ length: 40 }, (_, i) => {
  const topic = TOPICS[Math.floor(i / 10)];
  const body = `${topic.toLowerCase()} is discussed here with examples and derivations. `.repeat(25);
  return `[page ${i + 1}]\n${Math.floor(i / 10) + 2}.${(i % 10) + 1} ${topic} (Section ${"ABCDEFGHIJ"[i % 10]})\n${body}`;
}).join("\n\n");

describe("splitting material into pages", () => {
  it("uses the extractor's page and slide markers", () => {
    expect(splitPages(doc).map((p) => p.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(splitPages("--- Slide 1 ---\nIntro\n\n--- Slide 2 ---\nMore").map((p) => [p.n, p.text])).toEqual([[1, "Intro"], [2, "More"]]);
  });

  it("cuts unmarked text into page-sized pieces at paragraph breaks", () => {
    const pages = splitPages(Array.from({ length: 10 }, (_, i) => `Paragraph ${i} `.repeat(60)).join("\n\n"));
    expect(pages.length).toBeGreaterThan(3);
    expect(pages.every((p) => p.text.length <= 2600)).toBe(true);
  });

  it("finds headings and ignores sentences", () => {
    expect(headingsOf("2.3 Edge Detection\nThe gradient points across edges.\nSOBEL OPERATOR\nNon-Maximum Suppression")).toEqual([
      "2.3 Edge Detection",
      "SOBEL OPERATOR",
      "Non-Maximum Suppression",
    ]);
  });
});

describe("the page map for planning", () => {
  it("covers every page of a long document within the budget", () => {
    const map = documentMap(doc, 6000);
    expect(map.length).toBeLessThanOrEqual(6000);
    for (const t of TOPICS) expect(map).toContain(t);
    expect(map).toContain("p.1:");
    expect(map).toContain("p.40:");
  });

  it("returns short material unchanged", () => {
    expect(documentMap("short notes", 6000)).toBe("short notes");
  });

  it("groups pages when there are too many for one line each", () => {
    const long = Array.from({ length: 250 }, (_, i) => `[page ${i + 1}]\nTopic ${i + 1} Overview\nThis page explains topic number ${i + 1} in some detail. ${"text ".repeat(200)}`).join("\n");
    const map = documentMap(long, 6000);
    expect(map.length).toBeLessThanOrEqual(6000);
    expect(map).toMatch(/p\.2\d\d-25\d|p\.25\d/);
  });
});

describe("splitting a whole document into parts", () => {
  it("covers every content page exactly once, each part small enough to read in full", async () => {
    const { planParts } = await import("@/lib/source/document");
    const withFront = `[page 1]\nLecture Notes\n\n[page 2]\nContents\n2.1 Image Formation (Section A) . . . . . 3\n2.2 Image Formation (Section B) . . . . . 4\n3.1 Edge Detection (Section A) . . . . . 13\n3.2 Edge Detection (Section B) . . . . . 14\n\n${doc.replace(/\[page (\d+)\]/g, (_, n) => `[page ${Number(n) + 2}]`)}`;
    const parts = planParts(withFront, 5000);
    const covered = parts.flatMap((p) => parsePages(p.pages));
    expect(covered).toEqual(Array.from({ length: 40 }, (_, i) => i + 3)); // pages 3-42; title and contents pages left out
    for (const p of parts) expect(excerpt(withFront, { pages: p.pages, query: p.title }, 5000)).not.toContain("…");
    expect(parts[0].title).toMatch(/^2\.1 Image Formation \(Section A\)/);
    expect(parts.some((p) => p.title.startsWith("3.1 Edge Detection"))).toBe(true);
  });

  it("keeps going however long the document is", async () => {
    const { planParts } = await import("@/lib/source/document");
    const book = Array.from({ length: 300 }, (_, i) => `[page ${i + 1}]\n${i + 1}.1 Topic Heading ${"ABC"[i % 3]}\n${"Some explanation of this topic. ".repeat(60)}`).join("\n\n");
    const parts = planParts(book, 5000);
    expect(parts.flatMap((p) => parsePages(p.pages))).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
  });
});

describe("the pages a lesson part reads", () => {
  it("parses page ranges", () => {
    expect(parsePages("12-14, 20")).toEqual([12, 13, 14, 20]);
    expect(parsePages("p. 3–5")).toEqual([3, 4, 5]);
    expect(parsePages(undefined)).toEqual([]);
  });

  it("uses the pages the plan assigned, in reading order", () => {
    const text = excerpt(doc, { pages: "21-23", query: "anything" }, 5000);
    expect([...text.matchAll(/\[page (\d+)\]/g)].map((m) => Number(m[1]))).toEqual([21, 22, 23]);
  });

  it("otherwise finds the pages about the part's topic, not just the first pages", () => {
    const text = excerpt(doc, { query: "Optical flow: motion between frames" }, 5000);
    const pages = [...text.matchAll(/\[page (\d+)\]/g)].map((m) => Number(m[1]));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((n) => n >= 31)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(5000);
  });
});
