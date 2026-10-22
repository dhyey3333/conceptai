/**
 * Teaching from long material (a 60-page PDF, a slide deck).
 *
 * A whole document is far more than one request can carry, especially on a
 * free plan's per-minute token budget, and cutting it to the first pages
 * would teach only chapter 1. So the lesson planner gets a page map of the
 * whole document (the headings on each page), each lesson part gets the pages
 * it is about, and notes get the map when the text doesn't fit.
 */

export interface Page {
  n: number;
  text: string;
}

/** Page markers written by the extractor: "[page 12]" for PDFs, "--- Slide 3 ---" for decks. */
const MARK = /^(?:\[page (\d+)\]|--- Slide (\d+) ---)[ \t]*$/gm;

/** Split material into pages (or, without page markers, into page-sized pieces at paragraph breaks). */
export function splitPages(text: string): Page[] {
  const marks = [...text.matchAll(MARK)];
  if (!marks.length) {
    const out: Page[] = [];
    let cur = "";
    for (const para of text.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > 2500) {
        out.push({ n: out.length + 1, text: cur.trim() });
        cur = "";
      }
      cur += `${para}\n\n`;
    }
    if (cur.trim()) out.push({ n: out.length + 1, text: cur.trim() });
    return out;
  }
  return marks
    .map((m, i) => ({ n: Number(m[1] ?? m[2]), text: text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length).trim() }))
    .filter((p) => p.text);
}

const SMALL_WORDS = /^(of|and|the|in|for|to|a|an|on|with|vs\.?|by|or|at|from|as|via)$/i;
/** "2.3 Edge Detection", "1. Introduction", "Chapter 4 …": the document's own structure. */
const NUMBERED = /^(\d+\.\d+(\.\d+)*\.?|\d+\.|[IVX]+\.)\s+[A-Za-z]|^(chapter|unit|module|section|lecture|part|topic)\s+\S/i;

const lineOf = (l: string) => l.replace(/\s+/g, " ").trim();

/** Lines that look like headings: numbered, ALL CAPS, or short Title Case (equations and figure numbers excluded). */
export function headingsOf(page: string): string[] {
  return page
    .split("\n")
    .map(lineOf)
    .filter((l) => {
      if (l.length < 3 || l.length > 90 || /[.,;:]$/.test(l) || !/[A-Za-z]{2}/.test(l)) return false;
      if (/[=≈<>]/.test(l) || /\(\d+(\.\d+)*\)$/.test(l)) return false;
      if (NUMBERED.test(l)) return true;
      if (l === l.toUpperCase() && /[A-Z]{3}/.test(l)) return true;
      const words = l.split(" ");
      return words.length <= 8 && /^[A-Z]/.test(l) && words.every((w) => /^[A-Z0-9(“"'-]/.test(w) || SMALL_WORDS.test(w));
    });
}

/**
 * Running headers and footers ("6 CHAPTER 1. IMAGE FORMATION", "2.2 EPIPOLAR GEOMETRY 45"):
 * lines carrying the page's own number, or repeated (numbers aside) on many pages.
 */
function runningLines(pages: Page[]): (page: Page, line: string) => boolean {
  // Compare lines with a leading or trailing page number removed ("6 CHAPTER 1…" = "8 CHAPTER 1…").
  const norm = (l: string) => l.replace(/^\d+\s+|\s+\d+$/g, "").toLowerCase();
  const count = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.text.split("\n").map(lineOf).filter(Boolean).map(norm))) count.set(l, (count.get(l) ?? 0) + 1);
  const many = Math.max(4, Math.ceil(pages.length / 5));
  return (page, line) => {
    // Headers and footers are short; a long repeated line is content (never drop a paragraph).
    if (line.length <= 80 && (count.get(norm(line)) ?? 0) >= many) return true;
    // A header or footer is in the first or last two lines and carries the page's own number.
    const all = page.text.split("\n").map(lineOf).filter(Boolean);
    const edge = all.slice(0, 2).includes(line) || all.slice(-2).includes(line);
    const n = String(page.n);
    return edge && (line === n || line.startsWith(`${n} `) || line.endsWith(` ${n}`));
  };
}

/** What a page is about, in a few words: its numbered headings, else its first sentence, else other headings. */
function gist(page: Page, running: (page: Page, line: string) => boolean): string {
  const lines = page.text.split("\n").map(lineOf).filter((l) => l && !running(page, l));
  const heads = [...new Set(headingsOf(lines.join("\n")))];
  const structural = heads.filter((h) => NUMBERED.test(h));
  if (structural.length) return structural.slice(0, 3).join(" | ");
  const sentence = lines.find((l) => l.length > 30 && /[a-z]{3,} [a-z]{2,}/.test(l));
  if (sentence) return sentence;
  return heads.slice(0, 3).join(" | ");
}

/**
 * The whole document in at most maxChars: itself if it fits, otherwise one
 * line per page (or per few pages for very long ones) with what the page is
 * about, so the planner sees every chapter, not just the first.
 */
export function documentMap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const pages = splitPages(text);
  if (!pages.length) return text.slice(0, maxChars);
  const running = runningLines(pages);
  const group = Math.max(1, Math.ceil(pages.length / Math.max(1, Math.floor(maxChars / 70))));
  const lines: string[] = [];
  for (let i = 0; i < pages.length; i += group) {
    const run = pages.slice(i, i + group);
    const label = run.length > 1 ? `p.${run[0].n}-${run[run.length - 1].n}` : `p.${run[0].n}`;
    const about = [...new Set(run.map((p) => gist(p, running)).filter(Boolean))].join(" | ");
    // A page with nothing to say (blank, a lone number) is left out of the map.
    if (about) lines.push(`${label}: ${about}`);
  }
  // Pages with the same headings in a row (a topic spread over several slides) share one line.
  const merged: string[] = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    const [pl, pa] = prev ? [prev.slice(0, prev.indexOf(":")), prev.slice(prev.indexOf(":") + 2)] : ["", ""];
    const [cl, ca] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)];
    if (prev && pa === ca) merged[merged.length - 1] = `${pl.split("-")[0]}-${cl.replace(/^p\./, "").split("-").pop()}: ${ca}`;
    else merged.push(line);
  }
  const per = Math.max(40, Math.floor(maxChars / merged.length) - 2);
  return merged.map((l) => (l.length > per ? `${l.slice(0, per - 1)}…` : l)).join("\n").slice(0, maxChars);
}

export interface PartPlan {
  title: string;
  goal: string;
  pages: string;
}

/** A contents page: most lines end in a page number or dot leaders. */
function isContents(lines: string[]): boolean {
  const entries = lines.filter((l) => /\.{4,}\s*\d+$|\s\d{1,4}$/.test(l)).length;
  return lines.length >= 4 && entries / lines.length >= 0.4;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A real section number ("1.7", "2.3.4"), as opposed to a numbered list item ("2. Verify …"). */
const SECTION = /^\d+\.\d+(\.\d+)*\.?\s+[A-Za-z]/;
const sectionDepth = (h: string) => (/^[\d.]+/.exec(h)?.[0].replace(/\.$/, "").split(".").length ?? 9);

/** A part's title: its highest-level sections ("1.7 Affine Transformation & 1.8 Projective …"). */
function partTitle(heads: string[]): string | undefined {
  const sections = heads.filter((h) => SECTION.test(h));
  if (!sections.length) return undefined;
  const top = Math.min(...sections.map(sectionDepth));
  const main = sections.filter((h) => sectionDepth(h) === top);
  return main.slice(0, 2).join(" & ") + (main.length > 2 ? " …" : "");
}

/**
 * Split the whole material into lesson parts that together cover every page:
 * consecutive pages, each part small enough to be read in full in one request
 * (budget characters), starting a new part at the document's own section
 * headings where possible. Blank, title and contents pages are left out (they
 * have nothing to teach). However long the document, nothing is skipped: it
 * just becomes more parts. `fromPage` plans only the pages from there on
 * (the rest of a document, re-planned for a model that reads less).
 */
export function planParts(text: string, budget: number, fromPage = 0): PartPlan[] {
  const pages = splitPages(text);
  const running = runningLines(pages);
  const room = Math.max(1500, budget - 600); // markers and running headers take some of the budget
  const content = pages
    .map((p) => {
      const lines = p.text.split("\n").map(lineOf).filter((l) => l && !running(p, l));
      const body = lines.join("\n");
      return { n: p.n, size: body.length, lines, heads: headingsOf(body).filter((h) => NUMBERED.test(h)) };
    })
    .filter((p) => p.n >= fromPage && p.size >= 150 && !isContents(p.lines));
  const runs: (typeof content)[] = [];
  let cur: typeof content = [];
  let size = 0;
  for (const p of content) {
    const opensSection = SECTION.test(p.lines[0] ?? "") || /^(chapter|unit|module|part)\s+\S/i.test(p.lines[0] ?? "");
    if (cur.length && (size + p.size > room || (opensSection && size >= room * 0.6))) {
      runs.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.size + 14;
  }
  if (cur.length) runs.push(cur);
  let lastSection = "";
  return runs.map((run) => {
    const heads = [...new Set(run.flatMap((p) => p.heads))];
    const range = run.length > 1 ? `${run[0].n}-${run[run.length - 1].n}` : `${run[0].n}`;
    const title = partTitle(heads) ?? (lastSection ? `${lastSection} (continued)` : (heads[0] ?? `Pages ${range}`));
    const sections = heads.filter((h) => SECTION.test(h));
    if (sections.length) lastSection = sections[sections.length - 1];
    const goal = `Teach everything on pages ${range}${heads.length ? `: ${heads.join("; ")}` : ""}`;
    return { title: clip(title, 120), goal: clip(goal, 400), pages: range };
  });
}

/** "12-18", "p. 12–14, 20" → [12, …, 18] (at most 60 pages). */
export function parsePages(spec: string | undefined): number[] {
  const out: number[] = [];
  for (const m of (spec ?? "").matchAll(/(\d+)\s*(?:[-–—]|to)\s*(\d+)|(\d+)/g)) {
    const [a, b] = m[3] ? [Number(m[3]), Number(m[3])] : [Number(m[1]), Number(m[2])];
    for (let n = Math.min(a, b); n <= Math.max(a, b) && out.length < 60; n++) out.push(n);
  }
  return out;
}

const STOP = new Set("the and for with that this from are was were what how why when which into about their there these those will can also using use used its it's per via each than then them they such only more most some any all our your you who has have had not but one two between within over under".split(" "));
const terms = (s: string) => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));

/**
 * The part of the material a lesson part needs, in at most maxChars: the
 * pages the planner assigned to it, otherwise the pages that best match its
 * title and goal (each query word weighted by how rare it is in the document).
 * Pages come back in reading order, marked "[page N]".
 */
export function excerpt(text: string, opts: { pages?: string; query: string }, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const pages = splitPages(text);
  const wanted = new Set(parsePages(opts.pages));
  const q = [...new Set(terms(opts.query))];
  const df = new Map(q.map((t) => [t, pages.filter((p) => p.text.toLowerCase().includes(t)).length]));
  const score = (p: Page) => {
    const words = terms(p.text);
    let s = 0;
    for (const t of q) {
      const tf = words.filter((w) => w === t).length;
      if (tf) s += Math.min(tf, 5) * Math.log(1 + pages.length / (df.get(t) || 1));
    }
    return s + (wanted.has(p.n) ? 1e6 : 0);
  };
  const ranked = pages.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const order = (list: Page[]) => list.sort((a, b) => a.n - b.n).map((p) => `[page ${p.n}]\n${p.text}`).join("\n\n");
  // The assigned pages don't all fit: keep every one, each shortened to an equal share
  // (at least 400 characters; with very many pages, the most relevant ones).
  const assigned = ranked.filter((x) => wanted.has(x.p.n)).map((x) => x.p);
  if (assigned.reduce((n, p) => n + p.text.length + 14, 0) > maxChars) {
    const share = Math.max(400, Math.floor(maxChars / assigned.length) - 14);
    const fit = assigned.slice(0, Math.max(1, Math.floor(maxChars / (share + 14))));
    return order(fit.map((p) => ({ n: p.n, text: p.text.length > share ? `${p.text.slice(0, share - 1)}…` : p.text })));
  }
  const chosen: Page[] = [];
  let used = 0;
  for (const { p } of ranked.length ? ranked : pages.map((p) => ({ p }))) {
    const cost = p.text.length + 14;
    if (used + cost > maxChars) {
      if (!chosen.length) chosen.push({ n: p.n, text: p.text.slice(0, maxChars - 14) });
      continue;
    }
    chosen.push(p);
    used += cost;
  }
  return order(chosen);
}
