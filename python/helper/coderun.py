"""Run the Python a lesson shows, so the output on the board is the real output.

The code is written by the AI (and the AI may have read an uploaded PDF), so it
is treated as untrusted. Three layers, each enough for ordinary mistakes and
together a solid guard against code that tries to escape:

1. A static check before anything runs: imports only from a small list of
   pure-computation modules; no open/eval/exec/getattr and friends; no
   "__dunder__" attributes or names (except the few classes need, such as
   __init__); no frame or traceback attributes; no strings holding "__".
2. At run time the snippet gets its own builtins (the dangerous ones removed)
   and an import that hands out read-only views of the allowed modules, which
   hide private names and any module a module itself imported (dataclasses.sys).
3. It runs in a separate process: a few seconds at most, an empty temporary
   folder, an environment with nothing in it (no API keys), output capped.

This is a guard for lesson snippets, not a general sandbox. PY_RUN_CODE=off in
.env.local turns code running off.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass

# Modules a DSA or maths snippet needs. Not here on purpose: os, sys, io, pathlib,
# subprocess, socket, importlib, inspect, gc, pickle, ctypes, threading; and string
# and operator (string.Formatter and operator.attrgetter can read any attribute by name).
ALLOWED_MODULES = {
    "__future__", "abc", "array", "bisect", "collections", "copy", "dataclasses", "decimal", "enum",
    "fractions", "functools", "heapq", "itertools", "math", "queue", "random", "re", "statistics",
    "time", "typing",
}
# typing can evaluate strings as code (get_type_hints): only the names used in type hints.
TYPING_NAMES = {
    "Any", "Callable", "DefaultDict", "Deque", "Dict", "FrozenSet", "Generator", "Generic", "Hashable",
    "Iterable", "Iterator", "List", "Literal", "NamedTuple", "Optional", "Sequence", "Set", "Tuple",
    "TypeVar", "Union",
}
BLOCKED_NAMES = {
    "eval", "exec", "compile", "open", "input", "__import__", "globals", "locals", "vars", "getattr",
    "setattr", "delattr", "breakpoint", "exit", "quit", "help", "memoryview", "__builtins__", "__loader__",
    "__spec__", "__file__",
}
# Dunders a class definition or a "main" guard legitimately uses.
ALLOWED_DUNDERS = {
    "__init__", "__name__", "__main__", "__repr__", "__str__", "__len__", "__iter__", "__next__",
    "__eq__", "__lt__", "__le__", "__gt__", "__ge__", "__ne__", "__hash__", "__contains__",
    "__getitem__", "__setitem__", "__delitem__", "__bool__", "__add__", "__doc__", "__post_init__",
}
FRAME_ATTRS = {
    "gi_frame", "gi_code", "gi_yieldfrom", "cr_frame", "cr_code", "cr_await", "ag_frame", "ag_code",
    "ag_await", "tb_frame", "tb_next", "f_back", "f_globals", "f_locals", "f_builtins", "f_code", "f_trace",
}

MAX_CHARS = 6000
MAX_OUTPUT = 2000
TIMEOUT_S = 5.0


def _dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__")


def refuse(code: str) -> str | None:
    """Why this code will not be run (None: it may run)."""
    if len(code) > MAX_CHARS:
        return "too long to run"
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return None  # run it anyway: the real SyntaxError is what the lesson needs to hear about
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_MODULES:
                    return f"imports {a.name}"
                modules.add(a.asname or a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level or (node.module or "").split(".")[0] not in ALLOWED_MODULES:
                return f"imports from {node.module}"
            for a in node.names:
                if a.name == "*" or a.name.startswith("_"):
                    return f"imports {a.name} from {node.module}"
                if node.module == "typing" and a.name not in TYPING_NAMES:
                    return f"uses typing.{a.name}"
        elif isinstance(node, ast.Name):
            if node.id in BLOCKED_NAMES or (_dunder(node.id) and node.id not in ALLOWED_DUNDERS):
                return f"uses {node.id}"
        elif isinstance(node, ast.Attribute):
            if node.attr in FRAME_ATTRS or (_dunder(node.attr) and node.attr not in ALLOWED_DUNDERS):
                return f"uses .{node.attr}"
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if "__" in node.value and node.value != "__main__":
                return "has a string with __ in it"
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)) and _dunder(node.name) and node.name not in ALLOWED_DUNDERS:
            return f"defines {node.name}"
    # A module may only be used as module.name: never passed around, where its private parts could be reached.
    parents = {id(c): p for p in ast.walk(tree) for c in ast.iter_child_nodes(p)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in modules and isinstance(node.ctx, ast.Load):
            parent = parents.get(id(node))
            if not (isinstance(parent, ast.Attribute) and parent.value is node):
                return f"passes the module {node.id} around"
            if isinstance(parent, ast.Attribute) and parent.attr.startswith("_"):
                return f"uses {node.id}.{parent.attr}"
            if node.id == "typing" and parent.attr not in TYPING_NAMES:
                return f"uses typing.{parent.attr}"
    return None


# Runs in the child process. Cells share one namespace, like a notebook: a later snippet
# in a lesson part can use a class or function an earlier one defined.
RUNNER = r"""
import builtins, contextlib, io, json, sys, types, random
ALLOWED = set(json.loads(sys.argv[1]))
TYPING = set(json.loads(sys.argv[2]))
LIMIT = int(sys.argv[3])
cells = json.loads(sys.stdin.read())
real_import = builtins.__import__

class View:
    # Read-only view of an allowed module: no private names, no modules it imported.
    __slots__ = ("_m",)
    def __init__(self, m):
        object.__setattr__(self, "_m", m)
    def __getattr__(self, name):
        m = object.__getattribute__(self, "_m")
        if name.startswith("_") or (m.__name__ == "typing" and name not in TYPING):
            raise AttributeError(f"module '{m.__name__}' has no attribute '{name}'")
        v = getattr(m, name)
        if isinstance(v, types.ModuleType):
            if v.__name__.split(".")[0] in ALLOWED and v.__name__.startswith(m.__name__ + "."):
                return View(v)
            raise AttributeError(f"module '{m.__name__}' has no attribute '{name}'")
        return v
    def __setattr__(self, name, value):
        raise AttributeError("modules are read-only here")
    def __repr__(self):
        return f"<module '{object.__getattribute__(self, '_m').__name__}'>"

def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split(".")[0] not in ALLOWED:
        raise ImportError(f"{name} is not available in lesson code")
    m = real_import(name, globals, locals, fromlist, level)
    if not fromlist and "." in name:
        m = real_import(name.split(".")[0])
    return View(m)

BLOCKED = {"eval", "exec", "compile", "open", "input", "globals", "locals", "vars", "getattr", "setattr",
           "delattr", "breakpoint", "exit", "quit", "help", "memoryview"}
safe_builtins = {k: v for k, v in vars(builtins).items() if k not in BLOCKED and not (k.startswith("_") and k != "__build_class__")}
safe_builtins["__import__"] = safe_import

class Capped(io.StringIO):
    def write(self, s):
        room = LIMIT - self.tell()
        if room > 0:
            super().write(s[:room])
        return len(s)

random.seed(0)  # the same output every run
ns = {"__name__": "__main__", "__builtins__": safe_builtins}
results = []
for src in cells:
    buf = Capped()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(src, "<lesson>", "exec"), ns)
        results.append({"ok": True, "output": buf.getvalue()})
    except BaseException as e:
        line = None
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == "<lesson>":
                line = tb.tb_lineno
            tb = tb.tb_next
        if isinstance(e, SyntaxError):
            line = e.lineno
        results.append({"ok": False, "output": buf.getvalue(), "error": f"{type(e).__name__}: {e}"[:300], "line": line})
sys.__stdout__.write(json.dumps(results))
"""


@dataclass
class Result:
    ok: bool
    output: str = ""
    error: str | None = None
    line: int | None = None
    refused: str | None = None


def run_cells(cells: list[str], timeout: float = TIMEOUT_S) -> list[Result]:
    """Run snippets in order in one fresh process; one result per snippet."""
    cells = cells[:20]
    reasons = [refuse(c) for c in cells]
    # A refused snippet is not run, and neither is anything after it (it may depend on it).
    stop = next((i for i, r in enumerate(reasons) if r), len(cells))
    out: list[Result] = []
    if stop:
        out = _run(cells[:stop], timeout)
    for i in range(len(out), len(cells)):
        out.append(Result(ok=False, refused=reasons[i] or "an earlier snippet could not be run"))
    return out


def _run(cells: list[str], timeout: float) -> list[Result]:
    # Nothing from this process's environment (API keys live there): only what Windows
    # needs to start Python. PYTHONHASHSEED fixes set and dict-of-str ordering between runs.
    env = {k: os.environ[k] for k in ("SYSTEMROOT", "WINDIR") if k in os.environ}
    env.update({"PYTHONHASHSEED": "0", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"})
    with tempfile.TemporaryDirectory(prefix="conceptai-run-") as tmp:
        env["TEMP"] = env["TMP"] = tmp
        args = [sys.executable, "-s", "-P", "-c", RUNNER, json.dumps(sorted(ALLOWED_MODULES)), json.dumps(sorted(TYPING_NAMES)), str(MAX_OUTPUT)]
        try:
            p = subprocess.run(args, input=json.dumps(cells), capture_output=True, text=True, encoding="utf-8", timeout=timeout, cwd=tmp, env=env)
        except subprocess.TimeoutExpired:
            return [Result(ok=False, error=f"TimeoutError: still running after {timeout:g} s (an endless loop?)")] * len(cells)
    try:
        raw = json.loads(p.stdout)
    except json.JSONDecodeError:
        err = (p.stderr.strip().splitlines() or ["the run crashed"])[-1][:300]
        return [Result(ok=False, error=err)] * len(cells)
    results = [Result(ok=r["ok"], output=r.get("output", ""), error=r.get("error"), line=r.get("line")) for r in raw]
    # A timeout or crash part-way leaves the later cells without a result.
    return results + [Result(ok=False, error="the run stopped before this snippet")] * (len(cells) - len(results))
