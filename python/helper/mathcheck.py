"""
Exact checks of the maths a lesson writes on the board.

Equations arrive as LaTeX, e.g. "Z = \\frac{800 \\cdot 120}{100} = 960". Each side of
a chain of "=" / "\\approx" becomes a SymPy expression. Where two neighbouring
sides are pure numbers they must agree: exactly for "=" (allowing for the
rounding shown, so "\\sqrt{2} = 1.414" passes) and within 5% for "\\approx".
A derivation line that continues with "= ..." must also equal the line before
it as algebra. Anything that can't be read confidently is skipped, never
guessed: a false alarm would make the fact-check "fix" correct maths.

Nothing from the lesson is executed. LaTeX is turned into a small expression
language (numbers, + - * / ^, parentheses, a few functions, one-letter or Greek
symbols), checked character by character before SymPy parses it, and huge
powers are refused.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

GREEK = {
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa",
    "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Phi", "Psi", "Omega",
}
FUNCS = {"sqrt", "sin", "cos", "tan", "log", "exp", "Abs"}
UNITS = r"(?:mm|cm|km|nm|um|m|kg|mg|g|ms|s|min|h|Hz|kHz|MHz|GHz|N|J|kJ|W|kW|V|mV|A|mA|Pa|kPa|K|mol|L|mL|px|rad|dB)"
TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)
ALLOWED = re.compile(r"^[0-9A-Za-z+\-*/(). ,]*$")
MAX_LEN = 240


def _group(s: str, i: int) -> tuple[str, int] | None:
    """The {...} group starting at s[i] (which must be "{"), and the index after it."""
    if i >= len(s) or s[i] != "{":
        return None
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[i + 1 : j], j + 1
    return None


def _atom(s: str, i: int) -> tuple[str, int] | None:
    """A function argument: {group}, (paren), a number, or one symbol."""
    while i < len(s) and s[i] == " ":
        i += 1
    if i >= len(s):
        return None
    if s[i] == "{":
        return _group(s, i)
    if s[i] == "(":
        depth = 0
        for j in range(i, len(s)):
            depth += s[j] == "("
            depth -= s[j] == ")"
            if depth == 0:
                return s[i + 1 : j], j + 1
        return None
    m = re.match(r"\d+(?:\.\d+)?|[A-Za-z]", s[i:])
    return (m.group(0), i + m.end()) if m else None


def _replace_commands(s: str) -> str | None:
    """\\frac, \\sqrt, \\log_b, \\sin ... into function syntax; None if something unknown remains."""
    out = ""
    i = 0
    while i < len(s):
        if s[i] != "\\":
            out += s[i]
            i += 1
            continue
        m = re.match(r"\\([A-Za-z]+)", s[i:])
        if not m:
            return None
        name, i = m.group(1), i + m.end()
        if name in ("frac", "dfrac", "tfrac"):
            a = _group(s, i)
            b = a and _group(s, a[1])
            if not a or not b:
                return None
            na, nb = _replace_commands(a[0]), _replace_commands(b[0])
            if na is None or nb is None:
                return None
            out += f"(({na})/({nb}))"
            i = b[1]
        elif name == "sqrt":
            root = None
            if i < len(s) and s[i] == "[":
                end = s.find("]", i)
                if end < 0:
                    return None
                root, i = s[i + 1 : end], end + 1
            a = _group(s, i)
            if not a:
                return None
            inner = _replace_commands(a[0])
            if inner is None:
                return None
            out += f"(({inner})**(1/({root})))" if root else f"sqrt({inner})"
            i = a[1]
        elif name in ("log", "ln", "sin", "cos", "tan", "exp"):
            base = None
            if name == "log" and i < len(s) and s[i] == "_":
                b = _atom(s, i + 1)
                if not b:
                    return None
                base, i = b
            arg = _atom(s, i)
            if not arg:
                return None
            inner = _replace_commands(arg[0])
            if inner is None:
                return None
            i = arg[1]
            if name == "ln":
                out += f"log({inner})"
            elif name == "log":
                # Bare \log is read as base 10 (school and engineering use); \log_2 etc. as written.
                out += f"log({inner}, {base or 10})"
            else:
                out += f"{name}({inner})"
        elif name in GREEK:
            out += f" {name} "
        elif name == "pi":
            out += " pi "
        else:
            return None
    return out


def latex_to_sympy(tex: str) -> sp.Expr | None:
    """A side of an equation as a SymPy expression, or None when it can't be read safely."""
    s = tex.strip()
    if not s or len(s) > MAX_LEN:
        return None
    # Words and units are dropped, with any power on the unit ("\text{m/s}^2" must not square the number);
    # bold or blackboard letters keep their letter.
    s = re.sub(r"\\(?:text|mathrm|textrm|operatorname)\s*\{[^{}]*\}(?:\s*\^\s*(?:\{[^{}]*\}|-?\d))?", " ", s)
    s = re.sub(r"\\(?:mathbf|boldsymbol|mathit|vec|hat|bar)\s*\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\\(?:left|right|big|Big|bigg|Bigg|displaystyle)\b", " ", s)
    s = re.sub(r"\\[,;:! ]|\\q?quad\b|~", " ", s)
    s = s.replace("\\cdot", "*").replace("\\times", "*").replace("\\div", "/").replace("\\%", "/100")
    # Degrees: "30^\circ" -> "(30*pi/180)", bracketed so \sin 30^\circ reads it as one argument.
    s = re.sub(r"(\d+(?:\.\d+)?)\s*\^\s*\{?\s*\\circ\s*\}?", r"(\1*pi/180)", s)
    s = re.sub(rf"(\d)\s*{UNITS}\b", r"\1", s)  # "960 mm" -> 960
    # Subscripts become part of the name: v_0 -> v0, x_{max} -> xmax.
    s = re.sub(r"_\{([A-Za-z0-9]+)\}", r"\1", s)
    s = re.sub(r"(?<!\\log)_([A-Za-z0-9])", r"\1", s)
    s = _replace_commands(s)
    if s is None:
        return None
    s = s.replace("{", "(").replace("}", ")").replace("^", "**")
    if not ALLOWED.match(s) or "__" in s or re.search(r"[A-Za-z]\.|\.[A-Za-z]", s):
        return None
    for name in re.findall(r"[A-Za-z][A-Za-z0-9]*", s):
        ok = name in FUNCS or name in GREEK or name in ("pi", "E") or re.fullmatch(r"[A-Za-z][0-9]*|[A-Za-z]{1,4}[0-9]*", name)
        if not ok:
            return None
    local = {n: sp.Symbol(n) for n in GREEK} | {"pi": sp.pi, "E": sp.E, "sqrt": sp.sqrt, "log": sp.log, "exp": sp.exp, "Abs": sp.Abs}
    local |= {n: getattr(sp, n) for n in ("sin", "cos", "tan")}
    try:
        expr = parse_expr(s, local_dict=local, transformations=TRANSFORMS, evaluate=False)
    except Exception:
        return None
    if not isinstance(expr, sp.Expr):
        return None
    # Refuse anything that could take ages to evaluate (2^999999...).
    for p in expr.atoms(sp.Pow):
        e = p.exp
        if e.is_number and abs(float(e)) > 1000:
            return None
    for n in expr.atoms(sp.Integer):
        if abs(n) > 10**60:
            return None
    return expr


def _decimals(side: str) -> int:
    """Decimal places written in a side ("1.414" -> 3), which sets the rounding allowed."""
    found = re.findall(r"\d\.(\d+)", side)
    return max((len(d) for d in found), default=0)


def _value(expr: sp.Expr) -> float | None:
    if expr.free_symbols:
        return None
    try:
        v = complex(sp.N(expr.doit(), 30))
    except Exception:
        return None
    if abs(v.imag) > 1e-9:
        return None
    return v.real


def _same(a: float, b: float, sides: tuple[str, str], approx: bool) -> bool:
    rounding = max(0.5 * 10 ** -_decimals(sides[0]), 0.5 * 10 ** -_decimals(sides[1])) if any(map(_decimals, sides)) else 0
    tol = max(rounding * 1.001, 1e-9 * max(1, abs(b)))
    if approx:
        tol = max(tol, 0.05 * abs(b))
    return abs(a - b) <= tol


def _show(v: float) -> str:
    return f"{v:.0f}" if abs(v - round(v)) < 1e-9 else f"{v:.6g}"


@dataclass
class Finding:
    id: str
    latex: str
    message: str


RELATION = re.compile(r"(\\approx|\\neq|\\ne|\\leq?|\\geq?|<|>|=)")


def check_equation(item_id: str, tex: str) -> list[Finding]:
    """Check each "=" / "\\approx" link of one equation (a chain like a = b = c)."""
    parts = RELATION.split(tex)
    sides, rels = parts[0::2], parts[1::2]
    if not rels:
        return []
    found: list[Finding] = []
    exprs = [latex_to_sympy(s) for s in sides]
    for k, rel in enumerate(rels):
        if rel not in ("=", "\\approx"):
            continue
        a, b = exprs[k], exprs[k + 1]
        if a is None or b is None:
            continue
        va, vb = _value(a), _value(b)
        if va is None or vb is None:
            continue
        if not _same(va, vb, (sides[k], sides[k + 1]), rel == "\\approx"):
            sign = "≈" if rel == "\\approx" else "="
            found.append(Finding(item_id, tex, f"{sides[k].strip()} {sign} {sides[k + 1].strip()} is wrong: the left side is {_show(va)}, not {_show(vb)}"))
    return found


def check_steps(item_id: str, lines: list[str]) -> list[Finding]:
    """Each line of a derivation on its own, plus every line that continues "= ..." against the line before."""
    found: list[Finding] = []
    prev_last: str | None = None
    for i, line in enumerate(lines):
        found += check_equation(f"{item_id}.{i}", line)
        body = line.strip()
        # "T(n)" or "f(x)" may be a function or a product: compare such lines only when both are pure numbers.
        call = re.compile(r"(?<![\\A-Za-z])[A-Za-z]\s*\(")
        if body.startswith("=") and prev_last is not None:
            first = RELATION.split(body[1:])[0]
            a, b = latex_to_sympy(prev_last), latex_to_sympy(first)
            known = (sp.sin, sp.cos, sp.tan, sp.log, sp.exp, sp.Abs)
            # Only plain algebra: an unknown function such as T(n) can't be compared reliably.
            if a is not None and b is not None and not any(f.func not in known for f in (a.atoms(sp.Function) | b.atoms(sp.Function))):
                va, vb = _value(a), _value(b)
                if va is not None and vb is not None:
                    wrong = not _same(va, vb, (prev_last, first), False)
                elif call.search(prev_last) or call.search(first):
                    wrong = False
                else:
                    try:
                        wrong = sp.simplify(sp.expand(a - b)) != 0
                    except Exception:
                        wrong = False
                if wrong:
                    found.append(Finding(f"{item_id}.{i}", line, f"line {i + 1} doesn't follow: {prev_last.strip()} is not equal to {first.strip()}"))
        sides = RELATION.split(body.lstrip("="))
        prev_last = sides[-1] if sides and sides[-1].strip() else None
    return found
