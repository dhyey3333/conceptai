/**
 * Text and LaTeX rendering shared by the board, chat, quizzes and notes.
 *
 * KaTeX runs with trust:false, so model-written LaTeX cannot create links,
 * load images or inject HTML (\href, \url, \includegraphics, \htmlClass are
 * refused). Plain text segments are HTML-escaped before they are combined.
 */
import katex from "katex";

const cache = new Map<string, string>();
const CACHE_MAX = 600;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const knownCommands = new Map<string, boolean>();

/** Whether KaTeX knows \name (a missing argument is fine; an undefined command is not). */
function isKatexCommand(name: string): boolean {
  let known = knownCommands.get(name);
  if (known === undefined) {
    try {
      katex.renderToString(`\\${name}`, { throwOnError: true, strict: "ignore" });
      known = true;
    } catch (err) {
      known = !/undefined control sequence/i.test(err instanceof Error ? err.message : "");
    }
    knownCommands.set(name, known);
  }
  return known;
}

/**
 * Models sometimes escape a backslash twice in JSON, so "\frac" arrives as
 * "\\frac", which KaTeX reads as a line break followed by the word "frac".
 * Collapse a double backslash only when what follows is a real command; a
 * genuine line break before a command has three backslashes and is untouched.
 */
export function fixOverEscaped(latex: string): string {
  if (!latex.includes("\\\\")) return latex;
  return latex.replace(/(?<!\\)\\\\([a-zA-Z]+)/g, (m, name: string) => (isKatexCommand(name) ? `\\${name}` : m));
}

/** Render LaTeX to HTML. On a parse error, fall back to the escaped source. */
export function renderLatex(raw: string, display = false): string {
  const latex = fixOverEscaped(raw);
  const key = (display ? "D" : "I") + latex;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(latex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      maxSize: 20,
      maxExpand: 300,
      output: "html",
    });
  } catch {
    html = `<span class="math-fallback">${escapeHtml(latex)}</span>`;
  }
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}

type Segment = { kind: "text" | "math" | "bold"; value: string };

/** Split "Force is $F = ma$ and **mass** matters" into text / math / bold segments. */
export function splitRich(src: string): Segment[] {
  const out: Segment[] = [];
  // $$..$$, $..$ (not escaped \$), \(..\), and **bold**
  const re = /\$\$([^$]+)\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$|\\\((.+?)\\\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: "text", value: src.slice(last, m.index) });
    if (m[4] !== undefined) out.push({ kind: "bold", value: m[4] });
    else out.push({ kind: "math", value: (m[1] ?? m[2] ?? m[3]).trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", value: src.slice(last) });
  // Models sometimes write "\text{high}" in plain text, outside any $...$: show the word, not the command.
  const unwrap = (t: string) => t.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit)\{([^{}$]*)\}/g, "$1");
  return out.map((s) => (s.kind === "text" ? { ...s, value: unwrap(s.value.replace(/\\\$/g, "$")) } : s));
}

/** Rich text as one HTML string (no animation). */
export function richHtml(src: string): string {
  return splitRich(src)
    .map((s) =>
      s.kind === "math"
        ? renderLatex(s.value)
        : s.kind === "bold"
          ? `<strong class="rich-bold">${escapeHtml(s.value)}</strong>`
          : escapeHtml(s.value).replace(/\n/g, "<br/>"),
    )
    .join("");
}

/**
 * Diagram labels. Models often write "V_in = 9V" or "x^2" without $...$; when a
 * short label is clearly a formula (symbols joined only by operators), render
 * it as maths so subscripts and powers come out right.
 */
export function labelHtml(text: string): string {
  const looksLikeFormula =
    !text.includes("$") &&
    text.length <= 32 &&
    /[A-Za-z0-9)][_^][A-Za-z0-9{(]/.test(text) &&
    /^[^\s]+(\s*[=+\-×*/<>≈]\s*[^\s]+)*$/.test(text.trim());
  if (!looksLikeFormula) return richHtml(text);
  return renderLatex(text.trim().replace(/_([A-Za-z0-9]+)/g, "_{$1}").replace(/\^([A-Za-z0-9.]+)/g, "^{$1}"));
}

/**
 * Rich text split into "ink tokens" (words and formulas) so the board can write
 * them one after another, like a hand moving across the board.
 */
export function richTokensHtml(src: string, startIndex = 0): { html: string; count: number } {
  let i = startIndex;
  const parts: string[] = [];
  const word = (inner: string, cls = "") => `<span class="ink-w${cls}" style="--i:${i++}">${inner}</span>`;
  for (const seg of splitRich(src)) {
    if (seg.kind === "math") {
      parts.push(word(renderLatex(seg.value), " ink-math"));
      continue;
    }
    const lines = seg.value.split("\n");
    lines.forEach((line, li) => {
      if (li > 0) parts.push("<br/>");
      for (const tok of line.split(/(\s+)/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) parts.push(" ");
        else parts.push(word(seg.kind === "bold" ? `<strong class="rich-bold">${escapeHtml(tok)}</strong>` : escapeHtml(tok)));
      }
    });
  }
  return { html: parts.join(""), count: i - startIndex };
}

/** Make a narration string speakable: drop LaTeX and markdown the model let slip. */
export function speakable(text: string): string {
  return text
    .replace(/\$\$?([^$]+)\$\$?/g, (_, m: string) => latexToWords(m))
    .replace(/\\\((.+?)\\\)/g, (_, m: string) => latexToWords(m))
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function latexToWords(latex: string): string {
  return fixOverEscaped(latex)
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1 over $2")
    .replace(/\\sqrt\{([^}]*)\}/g, "root of $1")
    .replace(/\^2\b/g, " squared")
    .replace(/\^3\b/g, " cubed")
    .replace(/\^\{?([^}\s]+)\}?/g, " to the power $1")
    .replace(/_\{?([^}\s]+)\}?/g, " $1")
    .replace(/\\(times|cdot)/g, " times ")
    .replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|phi|rho|tau|epsilon|Delta|Omega)/g, " $1 ")
    .replace(/=/g, " equals ")
    .replace(/[{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
