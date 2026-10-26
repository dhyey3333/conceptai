/**
 * Models are told to double backslashes in JSON for LaTeX, and some then
 * double them in code too: a line break arrives as the two characters "\n"
 * and a quote as "\"", so `print(f\"Top\")` reaches the board and fails to run.
 *
 * Outside a string literal, Python has no backslash except a line
 * continuation (a backslash right before a real line break), so a "\n",
 * "\t" or "\"" there can only be an over-escaped line break, indent or quote,
 * and is undone. A string opened by an over-escaped quote is closed by one
 * too. Escapes inside ordinary strings ("a\nb") are left exactly as written.
 */
export function repairEscapes(code: string): string {
  if (!code.includes("\\")) return code;
  let out = "";
  let i = 0;
  let quote: string | null = null; // the open string's delimiter: ' " ''' or """
  let over = false; // that string was opened with an over-escaped quote
  const at = (s: string) => code.startsWith(s, i);
  while (i < code.length) {
    const c = code[i];
    if (quote === null) {
      if (c === "#") {
        // A comment runs to the end of the line, real or over-escaped; apostrophes in it open nothing.
        while (i < code.length && code[i] !== "\n" && !at("\\n")) out += code[i++];
        continue;
      }
      if (c === "\\" && (code[i + 1] === "n" || code[i + 1] === "t")) {
        out += code[i + 1] === "n" ? "\n" : "    ";
        i += 2;
        continue;
      }
      if (c === "\\" && (code[i + 1] === '"' || code[i + 1] === "'")) {
        const q = code[i + 1];
        quote = at(`\\${q}\\${q}\\${q}`) ? q.repeat(3) : q;
        over = true;
        out += quote;
        i += quote.length * 2;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = at(c.repeat(3)) ? c.repeat(3) : c;
        over = false;
        out += quote;
        i += quote.length;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (over) {
      const close = [...quote].map((q) => `\\${q}`).join("");
      if (at(close)) {
        out += quote;
        i += close.length;
        quote = null;
      } else if (at("\\\\")) {
        out += "\\";
        i += 2;
      } else out += code[i++];
      continue;
    }
    if (c === "\\") {
      out += code.slice(i, i + 2); // a real escape inside a string: keep it
      i += 2;
    } else if (at(quote)) {
      out += quote;
      i += quote.length;
      quote = null;
    } else {
      // A one-line string can't run past the end of its line.
      if (c === "\n" && quote.length === 1) quote = null;
      out += c;
      i++;
    }
  }
  return out;
}
