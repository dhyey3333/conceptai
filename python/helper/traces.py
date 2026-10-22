"""
Real runs of the algorithms lessons teach, so a worked example's steps are
computed, not guessed. Language models are weakest exactly here: they lose
track of an array two swaps into a heap sort. A lesson part about one of these
algorithms gets the exact sequence of steps for a small input, and the
fact-check gets the same trace as its reference.
"""

from __future__ import annotations

import re
from typing import Callable

Trace = dict  # {"algorithm", "input", "steps": [str], "states": [[int]], "text"}


def _arr(a: list) -> str:
    return "[" + ", ".join(str(x) for x in a) + "]"


def heap_sort(arr: list[int]) -> Trace:
    a = list(arr)
    n = len(a)
    steps: list[str] = []
    states: list[list[int]] = []

    def sift(i: int, size: int, phase: str) -> None:
        while True:
            l, r, big = 2 * i + 1, 2 * i + 2, i
            if l < size and a[l] > a[big]:
                big = l
            if r < size and a[r] > a[big]:
                big = r
            if big == i:
                return
            parent, child = a[i], a[big]
            a[i], a[big] = a[big], a[i]
            states.append(list(a))
            steps.append(f"{phase}: A[{i}]={parent} is smaller than its larger child A[{big}]={child}, swap them -> {_arr(a)}")
            i = big

    steps.append(f"Build a max-heap (children of index i are 2i+1 and 2i+2): heapify indices {n // 2 - 1} down to 0.")
    for i in range(n // 2 - 1, -1, -1):
        before = list(a)
        sift(i, n, f"heapify({i})")
        if a == before:
            steps.append(f"heapify({i}): A[{i}]={a[i]} is already larger than its children, no swap")
    steps.append(f"Max-heap built: {_arr(a)} (the root A[0]={a[0]} is the largest).")
    for end in range(n - 1, 0, -1):
        top = a[0]
        a[0], a[end] = a[end], a[0]
        states.append(list(a))
        steps.append(f"Swap the root {top} with the last heap element A[{end}]={a[0]} -> {_arr(a)}; {top} is now final, heap size {end}.")
        sift(0, end, f"sift-down (heap size {end})")
    steps.append(f"Sorted: {_arr(a)}")
    return {"algorithm": "heap sort", "input": list(arr), "steps": steps, "states": states}


def bubble_sort(arr: list[int]) -> Trace:
    a = list(arr)
    steps, states = [], []
    for p in range(len(a) - 1):
        swaps = []
        for j in range(len(a) - 1 - p):
            if a[j] > a[j + 1]:
                swaps.append(f"{a[j]}<->{a[j + 1]}")
                a[j], a[j + 1] = a[j + 1], a[j]
                states.append(list(a))
        steps.append(f"Pass {p + 1}: swaps {', '.join(swaps) if swaps else 'none'} -> {_arr(a)}" + ("" if swaps else " (no swaps: sorted, stop early)"))
        if not swaps:
            break
    steps.append(f"Sorted: {_arr(a)}")
    return {"algorithm": "bubble sort", "input": list(arr), "steps": steps, "states": states}


def selection_sort(arr: list[int]) -> Trace:
    a = list(arr)
    steps, states = [], []
    for i in range(len(a) - 1):
        m = min(range(i, len(a)), key=lambda k: a[k])
        if m != i:
            a[i], a[m] = a[m], a[i]
            states.append(list(a))
            steps.append(f"Pass {i + 1}: smallest of A[{i}..] is {a[i]} at index {m}; swap with A[{i}] -> {_arr(a)}")
        else:
            steps.append(f"Pass {i + 1}: smallest of A[{i}..] is {a[i]}, already at index {i} -> {_arr(a)}")
    steps.append(f"Sorted: {_arr(a)}")
    return {"algorithm": "selection sort", "input": list(arr), "steps": steps, "states": states}


def insertion_sort(arr: list[int]) -> Trace:
    a = list(arr)
    steps, states = [], []
    for i in range(1, len(a)):
        key, j = a[i], i - 1
        shifted = []
        while j >= 0 and a[j] > key:
            a[j + 1] = a[j]
            shifted.append(str(a[j]))
            j -= 1
        a[j + 1] = key
        states.append(list(a))
        steps.append(f"Insert {key}: shift {', '.join(shifted) if shifted else 'nothing'} right, place {key} at index {j + 1} -> {_arr(a)}")
    steps.append(f"Sorted: {_arr(a)}")
    return {"algorithm": "insertion sort", "input": list(arr), "steps": steps, "states": states}


def merge_sort(arr: list[int]) -> Trace:
    steps, states = [], []

    def sort(a: list[int]) -> list[int]:
        if len(a) <= 1:
            return a
        mid = len(a) // 2
        left, right = sort(a[:mid]), sort(a[mid:])
        out, i, j = [], 0, 0
        while i < len(left) and j < len(right):
            if left[i] <= right[j]:
                out.append(left[i])
                i += 1
            else:
                out.append(right[j])
                j += 1
        out += left[i:] + right[j:]
        steps.append(f"Merge {_arr(left)} and {_arr(right)} -> {_arr(out)}")
        states.append(out)
        return out

    result = sort(list(arr))
    steps.insert(0, f"Split {_arr(arr)} in halves recursively down to single elements, then merge back up:")
    steps.append(f"Sorted: {_arr(result)}")
    return {"algorithm": "merge sort", "input": list(arr), "steps": steps, "states": states}


def quick_sort(arr: list[int]) -> Trace:
    a = list(arr)
    steps, states = [], []

    def qs(lo: int, hi: int) -> None:
        if lo >= hi:
            return
        pivot, i = a[hi], lo
        for j in range(lo, hi):
            if a[j] < pivot:
                a[i], a[j] = a[j], a[i]
                i += 1
        a[i], a[hi] = a[hi], a[i]
        states.append(list(a))
        steps.append(f"Partition A[{lo}..{hi}] around pivot {pivot} (last element, Lomuto): smaller to the left -> {_arr(a)}, pivot at index {i}")
        qs(lo, i - 1)
        qs(i + 1, hi)

    qs(0, len(a) - 1)
    steps.append(f"Sorted: {_arr(a)}")
    return {"algorithm": "quick sort", "input": list(arr), "steps": steps, "states": states}


def binary_search(arr: list[int], target: int | None = None) -> Trace:
    a = sorted(arr)
    target = a[len(a) * 2 // 3] if target is None else target
    lo, hi = 0, len(a) - 1
    steps = [f"Search for {target} in the sorted array {_arr(a)} (indices 0 to {hi})."]
    while lo <= hi:
        mid = (lo + hi) // 2
        if a[mid] == target:
            steps.append(f"low={lo}, high={hi}: mid=({lo}+{hi})//2={mid}, A[{mid}]={a[mid]} equals {target}: found at index {mid}.")
            break
        if a[mid] < target:
            steps.append(f"low={lo}, high={hi}: mid=({lo}+{hi})//2={mid}, A[{mid}]={a[mid]} < {target}: search the right half, low={mid + 1}.")
            lo = mid + 1
        else:
            steps.append(f"low={lo}, high={hi}: mid=({lo}+{hi})//2={mid}, A[{mid}]={a[mid]} > {target}: search the left half, high={mid - 1}.")
            hi = mid - 1
    else:
        steps.append(f"low={lo} > high={hi}: {target} is not in the array.")
    return {"algorithm": "binary search", "input": a, "target": target, "steps": steps, "states": []}


def linear_search(arr: list[int], target: int | None = None) -> Trace:
    target = arr[len(arr) // 2] if target is None else target
    steps = [f"Search for {target} in {_arr(arr)}, checking each element in turn."]
    for i, x in enumerate(arr):
        if x == target:
            steps.append(f"A[{i}]={x} equals {target}: found at index {i} after {i + 1} comparisons.")
            break
        steps.append(f"A[{i}]={x} is not {target}.")
    else:
        steps.append(f"{target} is not in the array ({len(arr)} comparisons).")
    return {"algorithm": "linear search", "input": list(arr), "target": target, "steps": steps, "states": []}


GRAPH = {"A": ["B", "C"], "B": ["A", "D", "E"], "C": ["A", "F"], "D": ["B"], "E": ["B", "F"], "F": ["C", "E"]}


def bfs(_: list | None = None) -> Trace:
    order, seen, queue, steps = [], {"A"}, ["A"], [f"Graph (adjacency lists): {GRAPH}. Start at A, queue=[A]."]
    while queue:
        v = queue.pop(0)
        order.append(v)
        new = [w for w in GRAPH[v] if w not in seen]
        seen.update(new)
        queue += new
        steps.append(f"Visit {v}; enqueue unvisited neighbours {', '.join(new) or 'none'} -> queue={queue}")
    steps.append(f"BFS order: {' -> '.join(order)}")
    return {"algorithm": "breadth-first search", "input": GRAPH, "steps": steps, "states": []}


def dfs(_: list | None = None) -> Trace:
    order, seen, steps = [], set(), [f"Graph (adjacency lists): {GRAPH}. Start at A (recursive, neighbours in listed order)."]

    def go(v: str, depth: int) -> None:
        seen.add(v)
        order.append(v)
        steps.append(f"{'  ' * depth}Visit {v}")
        for w in GRAPH[v]:
            if w not in seen:
                go(w, depth + 1)

    go("A", 0)
    steps.append(f"DFS order: {' -> '.join(order)}")
    return {"algorithm": "depth-first search", "input": GRAPH, "steps": steps, "states": []}


def gcd(nums: list[int] | None = None) -> Trace:
    a, b = (nums or [252, 105])[:2]
    steps = [f"gcd({a}, {b}) by Euclid's algorithm: replace (a, b) with (b, a mod b) until b = 0."]
    while b:
        steps.append(f"{a} = {a // b} x {b} + {a % b} -> gcd({b}, {a % b})")
        a, b = b, a % b
    steps.append(f"gcd = {a}")
    return {"algorithm": "Euclid's GCD", "input": nums or [252, 105], "steps": steps, "states": []}


SORT_INPUT = [5, 2, 9, 1, 7, 3]
SEARCH_INPUT = [3, 7, 12, 18, 23, 27, 31, 35, 39]

# Most specific first: "heap sort" must win over "sort".
ALGORITHMS: list[tuple[str, str, Callable[..., Trace], list | None]] = [
    ("heap_sort", r"heap ?sort|heapify|build[- ]?(a )?max[- ]?heap|max[- ]?heap|min[- ]?heap|binary heap", heap_sort, SORT_INPUT),
    ("bubble_sort", r"bubble ?sort", bubble_sort, SORT_INPUT),
    ("selection_sort", r"selection ?sort", selection_sort, SORT_INPUT),
    ("insertion_sort", r"insertion ?sort", insertion_sort, SORT_INPUT),
    ("merge_sort", r"merge ?sort", merge_sort, SORT_INPUT),
    ("quick_sort", r"quick ?sort|lomuto|hoare partition", quick_sort, SORT_INPUT),
    ("binary_search", r"binary search", binary_search, SEARCH_INPUT),
    ("linear_search", r"linear search|sequential search", linear_search, SEARCH_INPUT),
    ("bfs", r"breadth[- ]first|\bbfs\b", bfs, None),
    ("dfs", r"depth[- ]first|\bdfs\b", dfs, None),
    ("gcd", r"euclid|\bgcd\b|greatest common divisor", gcd, None),
]


def detect(text: str) -> str | None:
    """The algorithm a piece of text is about: the one mentioned earliest (ties go to the more specific)."""
    best: tuple[int, int, str] | None = None
    for rank, (name, pattern, _, _) in enumerate(ALGORITHMS):
        m = re.search(pattern, text, re.IGNORECASE)
        if m and (best is None or (m.start(), rank) < best[:2]):
            best = (m.start(), rank, name)
    return best[2] if best else None


def run(name: str, data: list | None = None, target: int | None = None) -> Trace | None:
    for key, _, fn, default in ALGORITHMS:
        if key != name:
            continue
        values = [int(x) for x in data][:12] if data and all(isinstance(x, (int, float)) for x in data) else default
        trace = fn(values, target) if key in ("binary_search", "linear_search") else fn(values)
        trace["text"] = (
            f"WORKED EXAMPLE computed by actually running {trace['algorithm']}. Use THIS input for the part's worked example, "
            f"even if the goal suggests another one, and exactly these steps (you may group steps into fewer beats, but never "
            f"change a value):\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(trace["steps"]))
        )[:2500]
        return trace
    return None
