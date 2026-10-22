// Measure lesson accuracy with and without the Python tools (exact maths checks + real algorithm traces).
//
//   node eval/quality.mjs            (the app must be running on http://localhost:3100, helper included)
//   LIMIT=8 / ONLY=sort              fewer topics, or only those matching a pattern
//
// For each topic: plan one lesson, then write its worked-example part twice, once with the Python tools
// ("helper") and once without, so both use the same plan. Each final part (after the fact-check's fixes)
// is scored by:
//   - equation errors: equations and derivation steps that SymPy finds wrong (helper /math/check);
//   - trace errors: arrays shown as states of a sorting run that a real run on the same input never reaches
//     (helper /trace, on the first array the part uses as its input);
//   - fixes made by the fact-check, and how fast the first beat arrived.
// Writes eval/results/quality-<date>.md and .json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const APP = process.env.APP ?? "http://localhost:3100";
const HELPER = process.env.PY_HELPER_URL ?? "http://127.0.0.1:3110";
const TOPICS = [
  // Alternating, so LIMIT=8 still gives four algorithms and four calculation topics.
  ["Heap sort", "college"],
  ["Projectile motion", "senior"],
  ["Bubble sort", "college"],
  ["Ohm's law and series and parallel resistors", "senior"],
  ["Insertion sort", "college"],
  ["Compound interest", "school"],
  ["Quick sort", "college"],
  ["Newton's second law with friction", "senior"],
  ["Selection sort", "college"],
  ["Pinhole camera image magnification", "college"],
  ["Merge sort", "college"],
  ["Solving quadratic equations with the formula", "school"],
]
  .filter(([t]) => !process.env.ONLY || new RegExp(process.env.ONLY, "i").test(t))
  .slice(0, Number(process.env.LIMIT ?? 99));
const SORTS = { "heap sort": "heap_sort", "bubble sort": "bubble_sort", "insertion sort": "insertion_sort", "selection sort": "selection_sort", "merge sort": "merge_sort", "quick sort": "quick_sort" };

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Stream one part; returns the final beats (fixes applied) and timings. */
async function writePart(topic, level, outline, i, tier, helper) {
  const t0 = Date.now();
  const res = await post(`${APP}/api/lesson/section`, { topic, level, language: "english", depth: "quick", outline, sectionIndex: i, tier, helper });
  const beats = [];
  let firstBeat = null;
  let done = {};
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line);
      if (e.type === "beat") {
        firstBeat ??= Date.now() - t0;
        beats.push(e.beat);
      } else if (e.type === "fix") beats[e.index] = e.beat;
      else if (e.type === "done") done = e;
      else if (e.type === "error") throw new Error(e.message);
    }
  }
  return { beats, firstBeat, total: Date.now() - t0, fixes: done.fixes ?? 0, checked: !!done.checked };
}

/** Equations and derivations in the beats, as the app sends them to SymPy. */
function mathItems(beats) {
  const out = [];
  beats.forEach((b, i) =>
    b.draw.forEach((d, j) => {
      if (d.type === "math") out.push({ id: `${i}.${j}`, latex: d.latex });
      else if (d.type === "steps") out.push({ id: `${i}.${j}`, lines: d.lines.map((l) => l.latex) });
      else {
        const texts = d.type === "text" ? [d.text] : d.type === "bullets" ? d.items : d.type === "table" ? d.rows.flat() : [];
        texts.forEach((t, k) => [...t.matchAll(/\$([^$]+)\$/g)].forEach((m, n) => out.push({ id: `${i}.${j}.${k}.${n}`, latex: m[1] })));
      }
    }),
  );
  return out;
}

/** Every bracketed list of numbers in the part (board and narration), in order. */
function arrays(beats) {
  const found = [];
  const scan = (s) => {
    for (const m of String(s).matchAll(/\[\s*(-?\d+(?:\s*,\s*-?\d+){2,})\s*\]/g)) found.push(m[1].split(/\s*,\s*/).map(Number));
  };
  for (const b of beats) {
    scan(b.say);
    for (const d of b.draw) {
      if (d.type === "array") found.push(d.values.map(Number).filter((x) => Number.isFinite(x)));
      else scan(JSON.stringify(d));
    }
  }
  return found.filter((a) => a.length >= 3);
}

async function traceErrors(topic, beats) {
  const algorithm = SORTS[topic.toLowerCase()];
  if (!algorithm) return null;
  const arrs = arrays(beats);
  if (!arrs.length) return { input: null, shown: 0, wrong: 0 };
  const input = arrs[0];
  const r = await post(`${HELPER}/trace`, { algorithm, input }).then((x) => x.json());
  const valid = new Set([input, [...input].sort((a, b) => a - b), ...(r.trace?.states ?? [])].map((a) => a.join(",")));
  // Merge sort also shows its splits: any contiguous slice of the input is a correct split.
  if (algorithm === "merge_sort") for (let i = 0; i < input.length; i++) for (let j = i + 1; j <= input.length; j++) valid.add(input.slice(i, j).join(","));
  const key = [...input].sort((a, b) => a - b).join(",");
  // States of the same run: same values as the input, full length. Merge sort's sub-arrays are checked by its states too.
  const shown = arrs.slice(1).filter((a) => (algorithm === "merge_sort" ? true : a.length === input.length && [...a].sort((x, y) => x - y).join(",") === key));
  const wrong = shown.filter((a) => !valid.has(a.join(",")));
  return { input, shown: shown.length, wrong: wrong.length, examples: wrong.slice(0, 3) };
}

async function score(topic, part) {
  const items = mathItems(part.beats);
  const math = await post(`${HELPER}/math/check`, { items }).then((x) => x.json());
  return { ...part, equations: items.length, equationErrors: math.findings.length, mathExamples: math.findings.slice(0, 3).map((f) => f.message), trace: await traceErrors(topic, part.beats) };
}

// RESCORE=eval/results/<file>.json scores saved parts again (no AI calls), e.g. after fixing the scorer.
const saved = process.env.RESCORE ? JSON.parse(readFileSync(process.env.RESCORE, "utf8")).rows : null;
const rows = [];
for (const r of saved ?? []) {
  if (r.error) rows.push(r);
  else rows.push({ ...r, without: await score(r.topic, r.without), with: await score(r.topic, r.with) });
}
for (const [topic, level] of saved ? [] : TOPICS) {
  try {
    const o = await post(`${APP}/api/lesson/outline`, { topic, level, language: "english", depth: "quick", tierPref: "auto", researchPref: "off" }).then((x) => x.json());
    if (!o.outline) throw new Error(JSON.stringify(o).slice(0, 200));
    const secs = o.outline.sections;
    let i = secs.findIndex((s) => /example|trace|walk|in action|step|problem|numerical|calculat|solve/i.test(`${s.title} ${s.goal}`));
    if (i < 0) i = Math.floor(secs.length / 2);
    const row = { topic, part: secs[i].title };
    for (const helper of [false, true]) {
      row[helper ? "with" : "without"] = await score(topic, await writePart(topic, level, o.outline, i, o.tier, helper));
      const r = row[helper ? "with" : "without"];
      console.log(`${topic} [${helper ? "with" : "without"} Python]: ${r.equations} equations, ${r.equationErrors} wrong; trace ${r.trace ? `${r.trace.wrong}/${r.trace.shown} wrong` : "n/a"}; ${r.fixes} fixes; first beat ${(r.firstBeat / 1000).toFixed(1)} s`);
    }
    rows.push(row);
  } catch (err) {
    console.log(`${topic}: failed (${err.message})`);
    rows.push({ topic, error: err.message });
  }
}

const sum = (mode, f) => rows.filter((r) => r[mode]).reduce((n, r) => n + f(r[mode]), 0);
const totals = Object.fromEntries(
  ["without", "with"].map((m) => [
    m,
    {
      equations: sum(m, (r) => r.equations),
      equationErrors: sum(m, (r) => r.equationErrors),
      traceShown: sum(m, (r) => r.trace?.shown ?? 0),
      traceWrong: sum(m, (r) => r.trace?.wrong ?? 0),
      fixes: sum(m, (r) => r.fixes),
      firstBeat: sum(m, (r) => r.firstBeat ?? 0) / Math.max(1, rows.filter((r) => r[m]).length),
    },
  ]),
);
const date = process.env.RESCORE ? process.env.RESCORE.replace(/^.*quality-|\.json$/g, "") : new Date().toISOString().slice(0, 10);
mkdirSync("eval/results", { recursive: true });
writeFileSync(`eval/results/quality-${date}.json`, JSON.stringify({ date, rows, totals }, null, 2));
const line = (t) =>
  `| ${t.equationErrors} of ${t.equations} | ${t.traceWrong} of ${t.traceShown} | ${t.fixes} | ${(t.firstBeat / 1000).toFixed(1)} s |`;
writeFileSync(
  `eval/results/quality-${date}.md`,
  `# Lesson accuracy with and without the Python tools (${date})

${rows.filter((r) => !r.error).length} topics, the worked-example part of each, written twice from the same plan. Counts are for the final part, after the fact-check's corrections.

| | Wrong equations (SymPy) | Wrong algorithm states (real run) | Fact-check fixes | First beat (avg) |
|---|---|---|---|---|
| Without Python tools ${line(totals.without)}
| With Python tools ${line(totals.with)}

## Per topic

| Topic | Part | Without: wrong eq. / trace | With: wrong eq. / trace |
|---|---|---|---|
${rows
  .map((r) =>
    r.error
      ? `| ${r.topic} | failed: ${r.error.slice(0, 80)} | | |`
      : `| ${r.topic} | ${r.part} | ${r.without.equationErrors}/${r.without.equations} · ${r.without.trace ? `${r.without.trace.wrong}/${r.without.trace.shown}` : "n/a"} | ${r.with.equationErrors}/${r.with.equations} · ${r.with.trace ? `${r.with.trace.wrong}/${r.with.trace.shown}` : "n/a"} |`,
  )
  .join("\n")}
`,
);
console.log(`\nTOTALS ${JSON.stringify(totals)}\nwrote eval/results/quality-${date}.md`);
