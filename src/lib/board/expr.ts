/**
 * A tiny, safe math-expression compiler for plots.
 *
 * The AI writes functions like "9.8*x - 0.5*x^2" or "sin(2*pi*x)". We parse them
 * with a recursive-descent parser into a closure over a fixed whitelist of
 * operators, functions and constants. There is no eval/new Function anywhere, so
 * an expression can only ever compute a number from x.
 */

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, g: 9.8 };

type Fn = (x: number) => number;
type Token = { kind: "num"; value: number } | { kind: "id"; value: string } | { kind: "op"; value: string };

const MAX_LEN = 160;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const numMatch = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (numMatch) {
      out.push({ kind: "num", value: parseFloat(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }
    const idMatch = /^[a-zA-Zπθ][a-zA-Z0-9_]*/.exec(src.slice(i));
    if (idMatch) {
      out.push({ kind: "id", value: idMatch[0] === "π" ? "pi" : idMatch[0].toLowerCase() });
      i += idMatch[0].length;
      continue;
    }
    if (src.startsWith("**", i)) {
      out.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if ("+-*/^()×·÷−".includes(c)) {
      const map: Record<string, string> = { "×": "*", "·": "*", "÷": "/", "−": "-" };
      out.push({ kind: "op", value: map[c] ?? c });
      i++;
      continue;
    }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

/** Compile an expression in x. Throws on anything outside the whitelist. */
export function compileExpr(source: string): Fn {
  // Accept "y = ..." / "f(x) = ..." by keeping the right-hand side.
  let src = source.trim().slice(0, MAX_LEN);
  const eq = src.lastIndexOf("=");
  if (eq >= 0) src = src.slice(eq + 1);
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.kind === "op" && peek()!.value === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`);
    pos++;
  };

  // expr := term (('+'|'-') term)*
  function expr(): Fn {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].value;
      const a = left;
      const b = term();
      left = op === "+" ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return left;
  }

  // term := unary (('*'|'/') unary | implicit-multiplication)*
  function term(): Fn {
    let left = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = tokens[pos++].value;
        const a = left;
        const b = unary();
        left = op === "*" ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
        continue;
      }
      // "2x", "3sin(x)", "2(x+1)", "(x+1)(x-1)"
      const t = peek();
      if (t && (t.kind === "num" || t.kind === "id" || (t.kind === "op" && t.value === "("))) {
        const a = left;
        const b = unary();
        left = (x) => a(x) * b(x);
        continue;
      }
      return left;
    }
  }

  // unary := ('-'|'+') unary | power
  function unary(): Fn {
    if (isOp("-")) {
      pos++;
      const a = unary();
      return (x) => -a(x);
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  }

  // power := atom ('^' unary)?   (right-associative)
  function power(): Fn {
    const base = atom();
    if (isOp("^")) {
      pos++;
      const exp = unary();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  function atom(): Fn {
    const t = tokens[pos++];
    if (!t) throw new Error("Unexpected end");
    if (t.kind === "num") {
      const v = t.value;
      return () => v;
    }
    if (t.kind === "op" && t.value === "(") {
      const inner = expr();
      expectOp(")");
      return inner;
    }
    if (t.kind === "id") {
      if (t.value === "x" || t.value === "t") return (x) => x;
      const fn = FUNCS[t.value];
      if (fn) {
        // sin x, sin(x), sin^2(x) are all common in model output.
        if (isOp("^")) {
          pos++;
          const p = atom();
          const arg = isOp("(") ? atom() : unary();
          return (x) => Math.pow(fn(arg(x)), p(x));
        }
        const arg = isOp("(") ? atom() : power();
        return (x) => fn(arg(x));
      }
      if (t.value in CONSTS) {
        const v = CONSTS[t.value];
        return () => v;
      }
      throw new Error(`Unknown name "${t.value}"`);
    }
    throw new Error(`Unexpected "${t.value}"`);
  }

  const fn = expr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing input");
  return fn;
}

/** Sample f over [a, b]; non-finite values become null so the plot can break the line. */
export function sample(fn: Fn, a: number, b: number, n = 240): Array<{ x: number; y: number | null }> {
  const out: Array<{ x: number; y: number | null }> = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    let y: number | null;
    try {
      y = fn(x);
    } catch {
      y = null;
    }
    out.push({ x, y: y !== null && Number.isFinite(y) ? y : null });
  }
  return out;
}
