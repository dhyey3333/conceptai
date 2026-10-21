/**
 * Incremental extraction of JSON objects from a model's token stream.
 *
 * Models answer with {"beats":[{...},{...}]}, a bare array, or one object per
 * line, sometimes wrapped in ```json fences. We scan characters as they arrive,
 * track string/escape state and nesting, and emit each beat object the moment
 * its closing brace arrives, so the teacher can start speaking before the
 * model has finished writing the section.
 */

interface Frame {
  open: "{" | "[";
  start: number;
  /** an array whose object elements are emitted individually */
  emitsChildren: boolean;
}

/** Wrapper keys whose array elements are beats: {"beats":[...]} */
const LIST_KEYS = /"(beats|lesson|answer)"\s*:\s*$/;

export class JsonObjectStream {
  private buf = "";
  private scanned = 0;
  private stack: Frame[] = [];
  private inString = false;
  private escape = false;
  private topHadChildren = false;

  /** Feed a chunk; returns the raw text of every object completed by it. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const done: string[] = [];
    for (; this.scanned < this.buf.length; this.scanned++) {
      const c = this.buf[this.scanned];
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === "\\") this.escape = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') {
        if (this.stack.length) this.inString = true;
        continue;
      }
      if (c === "{" || c === "[") {
        if (this.stack.length === 0) this.topHadChildren = false;
        let emitsChildren = false;
        if (c === "[") {
          // A bare top-level array, or the "beats" array of a top-level wrapper object.
          if (this.stack.length === 0) emitsChildren = true;
          else if (this.stack.length === 1 && this.stack[0].open === "{") {
            const before = this.buf.slice(Math.max(this.stack[0].start, this.scanned - 40), this.scanned);
            emitsChildren = LIST_KEYS.test(before);
          }
        }
        this.stack.push({ open: c, start: this.scanned, emitsChildren });
        continue;
      }
      if (c === "}" || c === "]") {
        const frame = this.stack.pop();
        if (!frame) continue; // stray closer outside JSON
        if (c !== "}" || frame.open !== "{") continue;
        const parent = this.stack[this.stack.length - 1];
        if (parent?.emitsChildren) {
          done.push(this.buf.slice(frame.start, this.scanned + 1));
          this.topHadChildren = true;
        } else if (!parent && !this.topHadChildren) {
          // One object per line (NDJSON), or a single beat.
          done.push(this.buf.slice(frame.start, this.scanned + 1));
        }
      }
    }
    // Drop text that can no longer be part of an open object.
    if (this.stack.length === 0) {
      this.buf = "";
      this.scanned = 0;
    }
    return done;
  }
}

/**
 * Fix backslashes the model forgot to escape inside JSON strings.
 *
 * LaTeX in JSON must be written "\\frac", but models often write "\frac".
 * Worse, some of those are *valid* JSON escapes with the wrong meaning:
 * "\frac" -> form feed + "rac", "\theta" -> tab + "heta", "\nabla" -> newline.
 * Rule: inside strings, a backslash followed by two or more letters is LaTeX
 * (a real "\n" escape is followed by a non-letter or a capital, as in "\nThe"),
 * and a backslash before anything that is not a JSON escape is doubled.
 */
export function repairJsonEscapes(raw: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    if (c === '"') {
      inString = false;
      out += c;
      continue;
    }
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = raw[i + 1] ?? "";
    if (next === "\\" || next === '"' || next === "/") {
      out += c + next;
      i++;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
      out += raw.slice(i, i + 6);
      i += 5;
      continue;
    }
    if (/[a-zA-Z]/.test(next)) {
      const word = /^[a-zA-Z]+/.exec(raw.slice(i + 1))![0];
      const jsonEscape = "bfnrt".includes(next);
      const looksLikeLatex = word.length >= 2 && !(jsonEscape && /[A-Z]/.test(word[1]));
      if (jsonEscape && !looksLikeLatex) {
        out += c + next; // a genuine \n, \t ...
        i++;
        continue;
      }
      out += "\\\\"; // LaTeX command: keep the backslash literally
      continue;
    }
    // \, \; \{ \% \$ \_ and friends: not JSON escapes, so double them.
    out += "\\\\";
  }
  return out;
}

/** Parse model JSON tolerantly: fences, trailing commas and LaTeX escapes. */
export function parseLooseJson(raw: string): unknown {
  // Repaired text first: the unrepaired "\frac" would parse "successfully" as a form feed.
  const attempts = [repairJsonEscapes(raw), raw];
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      try {
        return JSON.parse(a.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        /* try next */
      }
    }
  }
  return undefined;
}

/** Parse the outermost JSON object in a complete response (fences and chatter around it are ignored). */
export function extractJsonObject(text: string): unknown {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const whole = parseLooseJson(text.slice(first, last + 1));
    if (whole !== undefined) return whole;
  }
  // Several objects or junk in between: take the first one that parses.
  for (const o of new JsonObjectStream().push(text)) {
    const v = parseLooseJson(o);
    if (v !== undefined) return v;
  }
  return undefined;
}
