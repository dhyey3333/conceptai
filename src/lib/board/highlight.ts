/**
 * Syntax colours for code on the board: a small tokenizer instead of a
 * highlighting library, since board code is short and in a few languages.
 * Tokens are plain text plus a kind; the board renders them as text, never HTML.
 */
import type { CODE_LANGS } from "./schema";

export type TokenKind = "kw" | "str" | "num" | "com" | "fn" | "def" | "plain";
export interface Token {
  text: string;
  kind: TokenKind;
}

type Lang = (typeof CODE_LANGS)[number];

const PY_KW = "and as assert break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield";
const PSEUDO_KW = `${PY_KW} then do end begin procedure function to downto repeat until each of let set`;
const C_KW = "auto bool break case catch char class const continue default delete do double else enum extern false float for if int long new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef unsigned using virtual void while";
const JAVA_KW = "abstract boolean break byte case catch char class continue default do double else extends final finally float for if implements import int interface long new null package private protected public return short static super switch this throw throws true false try void while var";
const JS_KW = "break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null of return super switch this throw true try typeof undefined var void while yield async await";
const SQL_KW = "select from where group by order having join left right inner outer on as insert into values update set delete create table primary key foreign references and or not null is in like limit distinct count sum avg min max";

const KEYWORDS: Record<Lang, Set<string>> = {
  python: new Set(PY_KW.split(" ")),
  pseudocode: new Set(PSEUDO_KW.split(" ")),
  c: new Set(C_KW.split(" ")),
  cpp: new Set(C_KW.split(" ")),
  java: new Set(JAVA_KW.split(" ")),
  javascript: new Set(JS_KW.split(" ")),
  sql: new Set(SQL_KW.split(" ")),
};
const PY_BUILTINS = new Set(
  "print len range enumerate zip min max sum sorted reversed list dict set tuple int str float bool abs map filter any all isinstance super iter next round divmod pow ord chr hash id type object".split(" "),
);
const COMMENT: Record<Lang, string> = { python: "#", pseudocode: "#", c: "//", cpp: "//", java: "//", javascript: "//", sql: "--" };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/** Split one line of code into coloured tokens. */
export function tokenizeLine(line: string, lang: Lang): Token[] {
  const kw = KEYWORDS[lang];
  const re = new RegExp(
    `(${esc(COMMENT[lang])}.*$)|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_][A-Za-z0-9_]*)|(\\s+|.)`,
    "g",
  );
  const out: Token[] = [];
  let prev = "";
  for (const m of line.matchAll(re)) {
    const [text, com, str, num, word] = m;
    let kind: TokenKind = "plain";
    if (com) kind = "com";
    else if (str) kind = "str";
    else if (num) kind = "num";
    else if (word) {
      const lower = lang === "sql" ? word.toLowerCase() : word;
      if (kw.has(lower)) kind = "kw";
      else if (prev === "def" || prev === "class" || prev === "function") kind = "def";
      else if (lang === "python" && PY_BUILTINS.has(word)) kind = "fn";
    }
    if (word) prev = word;
    // Merge neighbouring plain text so a line is a handful of spans, not one per character.
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === "plain") last.text += text;
    else out.push({ text, kind });
  }
  return out;
}
