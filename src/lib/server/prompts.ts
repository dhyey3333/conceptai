import type { Depth, Language, Level, Outline } from "@/lib/lesson/types";
import { documentMap, excerpt, parsePages, splitPages } from "@/lib/source/document";

export const LEVEL_TEXT: Record<Level, string> = {
  school:
    "a Class 6–10 school student. Use simple words and everyday examples, define every new term, and keep the maths gentle.",
  senior:
    "a Class 11–12 student preparing for board exams and JEE/NEET. Be rigorous: precise definitions, derivations, SI units, standard results and the traps examiners like.",
  college:
    "an undergraduate student. Use correct terminology, formal definitions and derivations, and connect ideas to real applications.",
  advanced:
    "a postgraduate or professional learner. Be concise and deep: formal treatment, assumptions, edge cases and current practice.",
};

const LANGUAGE_TEXT: Record<Language, string> = {
  english: "Speak in clear, warm, natural English.",
  hinglish:
    "Speak in natural Hinglish: conversational Hindi mixed with English, written in Roman script, the way India's favourite teachers explain (for example: \"Dekho, yeh concept bahut simple hai. Force ka matlab hai push ya pull.\"). Keep technical terms in English. Everything written on the board stays in English.",
  hindi:
    "Speak in simple, natural Hindi written in Devanagari script, keeping standard technical terms in English. Everything written on the board stays in English.",
};

const DEPTH_PLAN: Record<Depth, { sections: string; beats: string }> = {
  quick: { sections: "3", beats: "4 to 5" },
  standard: { sections: "4 or 5", beats: "5 to 7" },
  deep: { sections: "6 or 7", beats: "6 to 8" },
  // Parts come from the document itself (see planParts); each covers a few pages completely.
  full: { sections: "4 or 5", beats: "6 to 9" },
};

export function beatsPerSection(depth: Depth): string {
  return DEPTH_PLAN[depth].beats;
}

function persona(level: Level, language: Language): string {
  return `You are ConceptAI, a brilliant, energetic teacher in the style of the best YouTube and Physics Wallah educators. You teach on a digital whiteboard while speaking. Your student is ${LEVEL_TEXT[level]} ${LANGUAGE_TEXT[language]}`;
}

/** The whiteboard language. The renderer validates everything against this list. */
export const BOARD_SPEC = `WHITEBOARD ITEMS (the "draw" list). Only these types exist:
- {"type":"title","text":"..."}  lesson title, first beat of the lesson only
- {"type":"heading","text":"..."}  section heading
- {"type":"text","text":"...","tone":"normal|definition|important|example|tip"}  short board writing (max ~20 words). Inline math as $...$, key words as **bold**
- {"type":"bullets","items":["...","..."],"ordered":false}  2-6 short points
- {"type":"math","latex":"F = ma","label":"Newton's 2nd law","boxed":true}  a display equation in LaTeX (no $ signs). Box the key formulas
- {"type":"steps","lines":[{"latex":"...","note":"why"}]}  a derivation or worked solution, one line per step, each with a short note
- {"type":"table","headers":["...","..."],"rows":[["...","..."]]}  comparisons, data, units
- {"type":"flowchart","direction":"TB|LR","nodes":[{"id":"a","label":"...","shape":"box|round|diamond|circle"}],"edges":[{"from":"a","to":"b","label":"optional"}]}  processes, cycles, classifications (max 10 nodes, short labels)
- {"type":"figure","height":60,"caption":"...","shapes":[...]}  a labelled diagram you draw with shapes:
    {"shape":"line","x1":10,"y1":50,"x2":90,"y2":50,"dashed":false}
    {"shape":"arrow","x1":50,"y1":30,"x2":80,"y2":30,"label":"F"}
    {"shape":"rect","x":20,"y":20,"w":30,"h":20,"label":"block","fill":true}
    {"shape":"circle","cx":50,"cy":30,"r":10,"label":"..."}
    {"shape":"ellipse","cx":50,"cy":30,"rx":20,"ry":8}
    {"shape":"polygon","points":[[20,50],[80,50],[80,15]],"label":"..."}
    {"shape":"curve","points":[[10,40],[30,20],[50,40],[70,20]]}  smooth curve through points
    {"shape":"arc","cx":20,"cy":50,"r":8,"start":0,"end":35,"label":"θ"}  angle mark; degrees counter-clockwise from the +x direction
    {"shape":"point","x":20,"y":50,"label":"A"}
    {"shape":"text","x":50,"y":10,"text":"label, $math$ ok","size":"sm|md|lg"}
  Figure coordinates: x from 0 (left) to 100 (right); y from 0 (top) DOWN to "height" (default 60, max 120). Keep shapes 6+ units inside the edges so labels fit. Every shape may have "color".
- {"type":"plot","functions":[{"expr":"x^2","label":"$y=x^2$"}],"points":[{"x":2,"y":4,"label":"P"}],"xMin":-3,"xMax":3,"yMin":-1,"yMax":9,"xLabel":"x","yLabel":"y"}
  expr uses x with + - * / ^ ( ), sin cos tan sqrt abs ln log exp, pi, e. Use it for any relationship worth seeing as a graph.
- {"type":"tree","values":[9,5,8,4,2,7,6],"highlight":["0"],"caption":"max-heap"}  a binary tree in level order (heap/array order: children of index i are 2i+1 and 2i+2; null for an empty slot). Highlight nodes by index or label
- {"type":"tree","nodes":[{"id":"a","label":"Animals"},{"id":"b","label":"Mammals","parent":"a"},{"id":"c","label":"Birds","parent":"a","edge":"has wings"}]}  any other tree: hierarchy, recursion tree, decision tree, trie, BST ("side":"left|right" on each child of a binary tree)
- {"type":"array","label":"A","values":[3,7,12,18,23],"pointers":[{"index":0,"label":"low"},{"index":2,"label":"mid"}],"highlight":[2],"dim":[3,4],"caption":"step 1"}  an array, list, stack or memory row with index numbers ("start":1 for 1-based), named pointers, highlighted and greyed-out cells
  Trees and arrays are laid out by the board, so they are always neat: never draw them with figure shapes. To trace an algorithm, draw a new array (or tree) for each step, in the beat that explains that step.
Optional on any item: "id" (letters/digits, so you can point at it later), "color" (white|yellow|blue|green|red|pink|orange|purple; use colour with meaning, e.g. forces red, velocity blue), "size":"half" (half board width, so a figure or plot can sit beside a text or equation item drawn right before or after it).`;

const BEAT_RULES = `BEATS. You teach in beats. A beat is {"say":"...","draw":[...],"point":"optional id"}.
- "say" is exactly what you speak aloud: 1 to 3 sentences, at most 55 words, warm and conversational, addressed to the student as "you". Spoken words only: never LaTeX, markdown, symbols like ^ \\ _ or "$". Read maths naturally ("v equals u plus a t", "x squared").
- "draw" holds 0 to 3 items that appear on the board, in order, while that beat is spoken, like a teacher writing as they talk. Talk about what you are drawing in the same beat.
- The board is for what a great teacher writes: key terms, definitions, boxed formulas, labelled diagrams, graphs, worked steps. Never copy the speech onto the board.
- "point" (optional) is the id of an item drawn earlier; it gets highlighted while you refer back to it.

OUTPUT FORMAT: only a JSON object, no prose, no code fences: {"beats":[{...},{...}]}
In JSON strings, write every LaTeX backslash doubled: "\\\\frac{a}{b}", "\\\\theta".`;

const TEACHING_RULES = `HOW YOU TEACH
1. Intuition first: open with a relatable situation, question or picture, then formalise.
2. One idea per beat, building step by step. Pause to ask the student a quick question to think about.
3. Make it visual: every section needs at least one figure, plot, flowchart, table or derivation, whichever genuinely helps understanding.
4. Worked examples use real numbers; show every step and check the arithmetic and units.
5. Point out common mistakes and exam tips where they matter.
6. Be accurate. Never invent facts, formulas or data. When you trace an algorithm or work an example, check each step (indices, arithmetic, units) before you say it.`;

export function outlinePrompt(input: { topic: string; level: Level; language: Language; depth: Depth; sourceText?: string; research?: string; sourceBudget?: number }) {
  const plan = DEPTH_PLAN[input.depth];
  const system = `${persona(input.level, input.language)}

You are planning a whiteboard lesson. Design a clear teaching arc: hook and intuition, core definitions and concepts, the main principle (with derivation where the subject has one), worked example(s), applications and common misconceptions, and a short recap.

Return only a JSON object, no prose:
{"title":"lesson title (max 8 words)","subject":"e.g. Physics","difficulty":"basic|intermediate|advanced","summary":"one sentence on what the student will understand","objectives":["3 or 4 concrete learning outcomes"],"sections":[{"title":"short section title","goal":"what this section teaches AND what to draw (a diagram, graph, flowchart, derivation or worked example)"}]}
"difficulty" rates the topic itself: "advanced" means graduate or specialist material (e.g. measure theory, control-system design, quantum field theory); "basic" means school-level ideas.
Plan exactly ${plan.sections} sections. Section titles and goals must be in English.`;
  const user = `Topic: ${input.topic}${researchBlock(input.research, 4000)}${materialForPlan(input.sourceText, input.sourceBudget ?? 6000)}`;
  return { system, user };
}

export function sectionPrompt(input: {
  topic: string;
  level: Level;
  language: Language;
  depth: Depth;
  outline: Outline;
  sectionIndex: number;
  sourceText?: string;
  research?: string;
  sourceBudget?: number;
}) {
  const { outline, sectionIndex: i } = input;
  const section = outline.sections[i];
  const last = i === outline.sections.length - 1;
  const system = `${persona(input.level, input.language)}

${TEACHING_RULES}

${BEAT_RULES}

${BOARD_SPEC}`;
  // A long lesson (a whole document) lists only the neighbouring parts: the full list would crowd out the material.
  const near = outline.sections.length > 12;
  const shown = outline.sections.map((s, k) => ({ s, k })).filter(({ k }) => !near || Math.abs(k - i) <= 2);
  const outlineText = [
    near && i > 2 ? "…" : "",
    ...shown.map(({ s, k }) => `${k + 1}. ${s.title}${near && k !== i ? "" : `: ${s.goal}`}`),
    near && i < outline.sections.length - 3 ? "…" : "",
  ]
    .filter(Boolean)
    .join("\n");
  // A whole-document part gets more beats the more pages it covers (about 1.5 to 2 per page, up to 12).
  const pageCount = parsePages(section.pages).length;
  const beats =
    input.depth === "full" && pageCount
      ? `${Math.min(10, Math.max(6, Math.round(pageCount * 1.5)))} to ${Math.min(12, Math.max(8, pageCount * 2))}`
      : DEPTH_PLAN[input.depth].beats;
  const coverage =
    input.depth === "full" && input.sourceText?.trim()
      ? "\nThis lesson teaches the student's document completely, part by part, and this part covers the pages below. Teach everything on them, in the document's order: every definition, formula, derivation, figure and worked example. Don't add topics that aren't there; be brief on minor points rather than skip them."
      : "";
  const position =
    i === 0
      ? `This is the start of the lesson. Beat 1 draws the lesson title {"type":"title","text":"${outline.title.replace(/"/g, "'")}"} and greets the student with a hook: a real-life question or scenario. Then draw the heading for this section and begin.`
      : `Continue naturally from section ${i} (no greeting, no title). Beat 1 draws {"type":"heading","text":"${section.title.replace(/"/g, "'")}"} and links back to what came before.`;
  const ending = last
    ? " This is the final section: finish with a recap of the key points on the board (bullets or a boxed summary) and leave the student one question to think about."
    : "";
  const user = `Lesson: ${outline.title} (topic: ${input.topic})
${near ? "Outline around this part" : "Full outline"}:
${outlineText}

Now teach section ${i + 1} of ${outline.sections.length}: "${section.title}". Goal: ${section.goal}
${position}${ending}${coverage}
Write ${beats} beats.${researchBlock(input.research, 3500)}${materialForPart(input.sourceText, section, input.sourceBudget ?? 5000)}`;
  return { system, user };
}

/** Examiner-style review of a written lesson part, returning only the corrections. */
const CHECKER = `You are a meticulous subject expert and examiner checking teaching material before a student relies on it. Your only job is to find and fix real errors; do not restyle, shorten, reword or add content, and do not "fix" anything that is already correct.`;

const CHECK_STEPS = `Check, step by step:
1. Every factual claim, definition, formula, constant and unit.
2. Every number: recompute each arithmetic step yourself.
3. Every algorithm trace or worked example: redo it from the start (contents after each step, indices, which element is first or last, order of operations).
4. Anything misleading: a simplification that becomes wrong, or a claim stated more strongly than is true.`;

/** Review board beats (a lesson part or an answer); returns only the beats that need fixing. */
export function checkBeatsPrompt(input: {
  topic: string;
  level: Level;
  context: string;
  research?: string;
  beats: { say: string; draw: unknown[] }[];
  /** Index of the first beat shown (when a long part is checked a few beats at a time). */
  first?: number;
  /** Narration of the beats before these, for following a trace; not to be checked. */
  earlier?: string[];
}) {
  const first = input.first ?? 0;
  const beats = input.beats.map((b, i) => `[${first + i}] ${JSON.stringify({ say: b.say, draw: b.draw })}`).join("\n");
  const earlier = input.earlier?.length
    ? `\n\nWhat the teacher said just before (already checked; context only, do not fix):\n${input.earlier.slice(-6).map((s, i, a) => `[${first - a.length + i}] ${s}`).join("\n")}`
    : "";
  const user = `Topic: ${input.topic}. Learner: ${LEVEL_TEXT[input.level]}
${input.context}${researchBlock(input.research, 3000)}${earlier}

The material to check, one beat per line: [index] {"say": spoken narration, "draw": board items}
<beats>
${beats}
</beats>

${CHECK_STEPS}
5. Every board item against the narration and the facts: labels, values, order of elements, which node is where, arrow directions, axis labels, plotted functions and ranges.

Return only JSON.
If everything is correct: {"ok":true}
Otherwise: {"fixes":[{"beat":<index>,"say":"corrected narration","draw":[<complete corrected item list for that beat>]}]}
Include "say" and/or "draw" only for beats that change. In a corrected "draw", keep the correct items exactly as they were and use the same item format. The beats above are already valid JSON: escape LaTeX exactly as they do, with no extra backslashes.`;
  return { system: CHECKER, user };
}

/** Review a chunk of exam notes; corrections are exact find/replace pairs. */
export function checkNotesPrompt(input: { topic: string; level: Level; context: string; research?: string; notes: string }) {
  const user = `Topic: ${input.topic}. Learner: ${LEVEL_TEXT[input.level]}
${input.context}${researchBlock(input.research, 3000)}

<notes>
${input.notes}
</notes>

${CHECK_STEPS}
5. Every formula's symbols and units, every diagram's labels and values, and every model answer.

Return only JSON.
If everything is correct: {"ok":true}
Otherwise: {"fixes":[{"find":"exact text copied from the notes","replace":"corrected text"}]}
"find" must be copied character for character and be long enough to occur only once (a full sentence, line or equation). Keep fixes as small as possible. In JSON, write each backslash of the notes as \\\\ (so "\\\\frac" stands for \\frac).`;
  return { system: CHECKER, user };
}

/** Re-solve every quiz question and report the ones whose answer key is wrong. */
export function checkQuizPrompt(input: { topic: string; level: Level; context: string; research?: string; quiz: unknown }) {
  const user = `Topic: ${input.topic}. Learner: ${LEVEL_TEXT[input.level]}
${input.context}${researchBlock(input.research, 3000)}

<quiz>
${JSON.stringify(input.quiz)}
</quiz>

Solve every question yourself, independently, before looking at its stated answer. Then check:
1. MCQ: exactly one option is correct, "answer" is its 0-based index, and the explanation is right.
2. Numerical: recompute the answer from the given data; the unit, tolerance and every solution step are right, and the question gives all the data needed.
3. Short answer: the model answer is correct and complete for its marks.

Return only JSON.
If everything is correct: {"ok":true}
Otherwise: {"fixes":[{"section":"mcq"|"numerical"|"short","index":<0-based index in that list>,"question":{<only the fields that change, e.g. "answer", "options", "explanation", "solution", "q">}}]}
The quiz above is already valid JSON: escape LaTeX exactly as it does, with no extra backslashes.`;
  return { system: CHECKER, user };
}

export interface AskContext {
  topic: string;
  title: string;
  level: Level;
  language: Language;
  outline: string[];
  currentSection?: string;
  recentNarration: string[];
  board: string;
  chat: { role: "user" | "teacher"; text: string }[];
  research?: string;
}

export function askPrompt(input: { context: AskContext; question: string; mode: "question" | "simpler" | "example" | "about"; about?: string }) {
  const c = input.context;
  const system = `${persona(c.level, c.language)}

The student has interrupted your lesson. Answer like a great teacher would mid-class: direct, kind and clear, and use the board when a picture or equation helps.
- Write 1 to 4 beats. The first beat answers directly in one or two sentences.
- Draw compact items only (no title or heading). Use "size":"half" for figures and plots.
- Before answering, check the facts step by step: trace the algorithm, redo the arithmetic, re-derive the formula, read the board description carefully. Trust that check over anything said earlier.
- If the student says something you said or drew is wrong and they are right, the first beat says so plainly ("You're right, I made a mistake: ..."), gives the correct version, and the board shows the correction. Never defend a claim because you made it earlier.
- If the student is mistaken, explain kindly and precisely why, with a small example.
- If the question is unrelated to learning, or unsafe, kindly steer back to the lesson.
- Finish with a short bridge back to the lesson when the question was about it.

${BEAT_RULES}

${BOARD_SPEC}`;
  const task =
    input.mode === "simpler"
      ? `The student says they didn't understand. Re-explain the part you were just teaching much more simply, with an everyday analogy and a tiny example. 2 to 4 beats.${input.question ? ` Their words: "${input.question}"` : ""}`
      : input.mode === "example"
        ? `The student asks for another example. Give one fresh worked example for the part you were just teaching (with numbers if the topic allows), step by step on the board. 2 to 4 beats.`
        : input.mode === "about"
          ? `The student selected this item on the board:\n${input.about}\nTheir question: "${input.question || "Can you explain this?"}"`
          : `The student asks: "${input.question}"`;
  const user = `${contextBlock(c)}

${task}`;
  return { system, user };
}

function contextBlock(c: AskContext): string {
  const parts = [
    `LESSON: ${c.title} (topic: ${c.topic})`,
    c.outline.length ? `OUTLINE: ${c.outline.map((s, i) => `${i + 1}. ${s}`).join(" | ")}` : "",
    c.currentSection ? `CURRENT SECTION: ${c.currentSection}` : "",
    c.recentNarration.length ? `WHAT YOU JUST SAID (most recent last):\n${c.recentNarration.map((s) => `- ${s}`).join("\n")}` : "",
    c.board ? `ON THE BOARD NOW:\n${c.board}` : "",
    c.chat.length
      ? `EARLIER QUESTIONS IN THIS LESSON:\n${c.chat.map((m) => `${m.role === "user" ? "Student" : "Teacher"}: ${m.text}`).join("\n")}`
      : "",
    researchBlock(c.research, 2500).trim(),
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Facts gathered from the web before the lesson; preferred over the model's memory. */
function researchBlock(research: string | undefined, maxChars: number): string {
  if (!research?.trim()) return "";
  return `

RESEARCH BRIEF (gathered from the web for this lesson; where it differs from what you remember, trust it; do not mention it):
<research>
${research.slice(0, maxChars)}
</research>`;
}

/**
 * The student's material for planning: all of it if it fits, otherwise a map
 * of every page, so the plan covers the whole document and says which pages
 * each part teaches from.
 */
function materialForPlan(source: string | undefined, budget: number): string {
  if (!source?.trim()) return "";
  const whole = source.length <= budget;
  return `

The student wants to learn from their own material. Plan the lesson around what it covers, in its order and terminology, and cover all of it rather than only the beginning. If the topic above is just a file name, take the real topic from the material.${
    whole
      ? ""
      : ` The material is long (${splitPages(source).length} pages), so below is a map: what each page covers. For each section also give "pages": the page range it teaches from, e.g. "12-18".`
  }
<source>
${whole ? source : documentMap(source, budget)}
</source>`;
}

/** The pages of the student's material that one lesson part teaches from. */
function materialForPart(source: string | undefined, section: { title: string; goal: string; pages?: string }, budget: number): string {
  if (!source?.trim()) return "";
  return `

Teach this part from the student's material: follow its content, notation and terminology. Where it is brief, explain more; where it is wrong, teach it correctly.
<source>
${excerpt(source, { pages: section.pages, query: `${section.title} ${section.goal}` }, budget)}
</source>`;
}

/** Notes cover the whole material: all of it if it fits, otherwise a page map plus the most relevant pages. */
function materialForNotes(source: string, topic: string, budget: number): string {
  if (source.length <= budget) return source;
  const half = Math.floor(budget / 2);
  return `${documentMap(source, half)}\n\nKey pages:\n${excerpt(source, { query: topic }, budget - half)}`;
}

export const MARK_GUIDE: Record<number, string> = {
  2: "### 2-Mark Questions\n3 to 4 questions; each answer 2 to 4 crisp lines (definition, statement or one-step reasoning).",
  5: "### 5-Mark Questions\n2 to 3 questions; each answer about 120 to 180 words, structured in points, with a formula or labelled diagram where it earns marks.",
  10: "### 10-Mark Questions\n1 to 2 questions; each answer about 300 to 400 words: introduction, detailed explanation with subheadings, derivation or diagram, example, conclusion.",
  15: "### 15-Mark Questions\n1 question; a long answer of about 500 to 700 words: introduction, detailed body with subheadings, derivation and/or diagram, worked example, applications, conclusion.",
};

export function notesPrompt(input: {
  topic: string;
  level: Level;
  marks: number[];
  outline?: string;
  sourceText?: string;
  sourceNames?: string[];
  research?: string;
  references?: { title: string; url: string }[];
  /** Characters of the material that fit in the request (see sourceBudget). */
  sourceBudget?: number;
}) {
  const marks = [...input.marks].sort((a, b) => a - b);
  const system = `You are an expert teacher and exam-paper setter. Write comprehensive, exam-ready study notes in Markdown for ${LEVEL_TEXT[input.level]}

Use this structure (adapt section names sensibly to the subject; for non-quantitative topics replace "Derivations" with "Key Processes / Mechanisms"):
# <Title>
> A short overview: what it is and why it matters.
## 1. Key Definitions
## 2. Detailed Explanation   (subsections with ###; explain the why, not just the what)
## 3. Important Formulas     (each as display math with symbol meanings and SI units)
## 4. Derivations            (numbered steps, each justified)
## 5. Diagrams               (see diagram rules; caption each one in italics)
## 6. Worked Examples        (at least 3, easy to hard: Given / To find / Solution steps / Answer with units)
## 7. Applications
## 8. Common Mistakes & Exam Tips
## 9. Quick Revision Summary (a bullet cheat-sheet)
## 10. Important Questions with Answers
${marks.map((m) => MARK_GUIDE[m]).join("\n")}
Write each question in bold, followed by its full model answer.

Formatting rules:
- Maths uses KaTeX syntax: inline $...$ and display $$...$$ on their own lines. Use \\begin{aligned} for multi-line work. No HTML.
- Diagrams: for processes, cycles, hierarchies and classifications use a fenced \`\`\`mermaid block (flowchart TD or LR; put labels with spaces or symbols in quotes, e.g. A["Light energy"]). For geometry, physics setups, graphs, trees and arrays (data structures, algorithm steps) use a fenced \`\`\`diagram block holding ONE JSON whiteboard item (a "figure" with shapes, a "plot", a "tree" or an "array"), from this specification:
${BOARD_SPEC.split("\n").filter((l) => /figure|plot|shape|Figure coordinates|expr uses|"type":"tree"|"type":"array"|Trees and arrays/.test(l)).join("\n")}
- Be accurate and complete; do not pad. Check every numerical answer.${
    input.references?.length
      ? `\n- End with a "## References" section listing exactly these sources as Markdown links (do not add others):\n${input.references
          .map((r) => `  - [${r.title.replace(/[[\]]/g, "")}](${r.url})`)
          .join("\n")}`
      : ""
  }`;
  const user = `Topic: ${input.topic}${input.outline ? `\n\nThe student just learned this lesson outline; cover all of it:\n${input.outline}` : ""}${
    input.sourceText?.trim()
      ? `\n\nSOURCE MATERIAL${input.sourceNames?.length ? ` (${input.sourceNames.join(", ")})` : ""}: treat it as the syllabus. Cover every topic and unit it lists, follow its terminology and order, and give extra depth where it puts emphasis.\n<source>\n${materialForNotes(input.sourceText, input.topic, input.sourceBudget ?? 40000)}\n</source>`
      : ""
  }${researchBlock(input.research, 6000)}`;
  return { system, user };
}

/**
 * Continue notes that stopped at the output limit (common on free plans with a
 * small per-minute token budget). Only the tail and the headings so far are
 * sent, so the request stays small enough to fit the same budget.
 */
export function notesContinuation(notesSoFar: string): string {
  const headings = notesSoFar
    .split("\n")
    .filter((l) => /^#{1,3}\s/.test(l))
    .join("\n")
    .slice(-2500);
  return `The notes were cut off by the output limit. Headings written so far:\n${headings}\n\nThe notes end with:\n<tail>\n${notesSoFar.slice(-2000)}\n</tail>\n\nContinue exactly where the tail stops (even mid-sentence or mid-equation), in the same structure and formatting, and finish all remaining sections. Do not repeat anything already written and do not restart.`;
}

export function quizPrompt(input: { topic: string; level: Level; outline?: string; recent?: string; research?: string }) {
  const system = `You are an expert examiner creating practice questions for ${LEVEL_TEXT[input.level]}
Return only a JSON object, no prose:
{"mcq":[{"q":"question","options":["A","B","C","D"],"answer":0,"explanation":"why the right option is right and the tempting wrong one is wrong"}],
 "numerical":[{"q":"problem with all needed data","answer":12.5,"unit":"m/s","tolerance":0.02,"solution":["step 1","step 2","final answer with unit"]}],
 "short":[{"q":"question","marks":2,"answer":"model answer"}]}
Write 5 MCQs (answer = index of the correct option; mix conceptual and applied; plausible distractors), 2 or 3 numerical problems whenever the topic involves any formula or calculation (most maths, science, engineering and economics topics; leave the list empty only for purely descriptive topics), and 3 short-answer questions (2 or 5 marks). A numerical "answer" is a plain number; put the unit in "unit".
Use $...$ for inline maths (double every backslash inside JSON strings). Solve every problem yourself and make sure the stated answers are correct.`;
  const user = `Topic: ${input.topic}${input.outline ? `\nLesson outline:\n${input.outline}` : ""}${input.recent ? `\nWhat was taught:\n${input.recent}` : ""}${researchBlock(input.research, 3000)}`;
  return { system, user };
}
