from helper.coderun import refuse, run_cells

BFS = """
from collections import deque

def bfs(graph, start):
    seen, order, q = {start}, [], deque([start])
    while q:
        v = q.popleft()
        order.append(v)
        for w in graph[v]:
            if w not in seen:
                seen.add(w)
                q.append(w)
    return order

print(bfs({"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}, "A"))
"""


def test_runs_a_snippet_and_returns_what_it_prints():
    [r] = run_cells([BFS])
    assert r.ok and r.output == "['A', 'B', 'C', 'D']\n"


def test_later_snippets_use_what_earlier_ones_defined():
    node = "class Node:\n    def __init__(self, val):\n        self.val = val\n        self.next = None\n"
    use = "head = Node(1)\nhead.next = Node(2)\nprint(head.val, head.next.val)\n"
    main = 'if __name__ == "__main__":\n    print("main")\n'
    assert [r.output for r in run_cells([node, use, main])] == ["", "1 2\n", "main\n"]


def test_reports_the_error_and_the_line():
    [r] = run_cells(["x = [1, 2, 3]\nprint(x[3])\n"])
    assert not r.ok and r.error.startswith("IndexError") and r.line == 2


def test_stops_an_endless_loop():
    [r] = run_cells(["while True:\n    pass\n"], timeout=2)
    assert not r.ok and r.error.startswith("TimeoutError")


def test_same_output_every_run():
    code = "import random\nprint({'apple', 'banana', 'cherry', 'date'}, random.randint(1, 100))\n"
    assert run_cells([code])[0].output == run_cells([code])[0].output


def test_long_output_is_capped():
    [r] = run_cells(["for i in range(100000):\n    print(i)\n"])
    assert r.ok and len(r.output) <= 2000


def test_refuses_code_that_reaches_outside_the_lesson():
    for code in [
        "import os\nos.system('dir')",
        "import subprocess",
        "from sys import modules",
        "open('secrets.txt').read()",
        "eval('1+1')",
        "getattr(print, 'x')",
        "().__class__.__bases__[0].__subclasses__()",
        "def f(): yield 1\nf().gi_frame.f_globals",
        "x = '__import__'",
        "import random\nrandom._os",
        "import random\nm = random\nprint(m)",
        "from typing import get_type_hints",
        "import typing\ntyping.get_type_hints",
        "from random import _inst",
    ]:
        assert refuse(code), code


def test_a_refused_snippet_and_the_ones_after_it_are_not_run():
    results = run_cells(["print(1)", "import os", "print(2)"])
    assert [r.output for r in results] == ["1\n", "", ""]
    assert results[1].refused == "imports os" and results[2].refused


def test_modules_hide_the_modules_they_imported():
    # Passes the static check (sys is not private), but the module view refuses it at run time.
    [r] = run_cells(["import dataclasses\nprint(dataclasses.sys)"])
    assert not r.ok and "has no attribute 'sys'" in r.error
    [r] = run_cells(["from collections import deque, abc\nprint(deque([1]), abc.Iterable is not None)"])
    assert r.ok and r.output == "deque([1]) True\n"


def test_the_lessons_own_type_hints_still_work():
    code = "from typing import List, Optional\nfrom dataclasses import dataclass\n\n@dataclass\nclass P:\n    x: int\n\ndef first(xs: List[int]) -> Optional[int]:\n    return xs[0] if xs else None\n\nprint(first([P(3).x]))\n"
    [r] = run_cells([code])
    assert r.ok and r.output == "3\n"
