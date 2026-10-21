"use client";

import { useMemo, useState } from "react";
import { Whiteboard, type BoardEntry } from "@/components/board/Whiteboard";
import { sanitizeItem, type BoardItem } from "@/lib/board/schema";
import { allocateTimings } from "@/lib/board/timing";

/**
 * Board items the way models write them, including awkward cases (long
 * labels, wide equations, deep or lopsided trees, crowded figures), so
 * drawing bugs show up here instead of in a lesson.
 */
const PAGES: Record<string, unknown[]> = {
  trees: [
    { type: "heading", text: "Trees" },
    { type: "tree", values: [9, 5, 8, 4, 2, 7, 6], highlight: ["0"], caption: "max-heap (level order)", size: "half" },
    { type: "tree", values: [1, 3, 2, 7, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15], caption: "min-heap, 15 nodes", size: "half" },
    { type: "tree", nodes: [{ id: "a", label: "1" }, { id: "b", label: "2", parent: "a", side: "right" }, { id: "c", label: "3", parent: "b", side: "right" }, { id: "d", label: "4", parent: "c", side: "right" }, { id: "e", label: "5", parent: "d", side: "right" }], caption: "skewed BST (sorted inserts)", size: "half" },
    { type: "tree", root: { value: 50, left: { value: 30, left: { value: 20 }, right: { value: 40 } }, right: { value: 70, left: { value: 60 } } }, caption: "BST from a nested object", size: "half" },
    { type: "tree", nodes: [{ id: "f4", label: "fib(4)" }, { id: "f3", label: "fib(3)", parent: "f4" }, { id: "f2a", label: "fib(2)", parent: "f4" }, { id: "f2b", label: "fib(2)", parent: "f3" }, { id: "f1a", label: "fib(1)", parent: "f3" }, { id: "f1b", label: "fib(1)", parent: "f2b" }, { id: "f0a", label: "fib(0)", parent: "f2b" }, { id: "f1c", label: "fib(1)", parent: "f2a" }, { id: "f0b", label: "fib(0)", parent: "f2a" }], highlight: ["f2a", "f2b"], caption: "recursion tree: repeated subproblems highlighted" },
    { type: "tree", nodes: [{ id: "q", label: "Outlook?" }, { id: "s", label: "Humidity?", parent: "q", edge: "sunny" }, { id: "o", label: "Play", parent: "q", edge: "overcast" }, { id: "r", label: "Wind?", parent: "q", edge: "rain" }, { id: "h", label: "Don't play", parent: "s", edge: "high" }, { id: "n", label: "Play", parent: "s", edge: "normal" }], caption: "decision tree with edge labels", size: "half" },
    { type: "tree", nodes: [{ id: "x", label: "$x_1$" }, { id: "y", label: "$x_2^2$", parent: "x" }, { id: "z", label: "$\\sqrt{n}$", parent: "x" }], caption: "maths in nodes", size: "half" },
  ],
  arrays: [
    { type: "heading", text: "Arrays" },
    { type: "array", label: "A", values: [3, 7, 12, 18, 23, 27, 31, 35, 39], pointers: [{ index: 0, label: "low" }, { index: 4, label: "mid" }, { index: 8, label: "high" }], highlight: [4], caption: "binary search, step 1" },
    { type: "array", label: "A", values: [3, 7, 12, 18, 23, 27, 31, 35, 39], pointers: { low: 5, mid: 6, high: 8 }, dim: [0, 1, 2, 3, 4], caption: "step 2: left half discarded" },
    { type: "array", values: Array.from({ length: 24 }, (_, i) => (i * 37) % 100), caption: "24 cells (the maximum)" },
    { type: "array", values: ["apple", "banana", "cherry", null, "elderberry"], start: 1, pointers: [{ index: 4, label: "empty slot" }], size: "half" },
    { type: "array", values: [5, 1, 4, 2, 8], pointers: [{ index: 1, label: "j" }, { index: 1, label: "j+1" }], highlight: [0, 1], caption: "two pointers on one cell", size: "half" },
    { type: "array", values: ["$\\infty$", 0, "$-\\infty$"], label: "dist", indices: false, size: "half" },
  ],
  figures: [
    { type: "heading", text: "Figures, flowcharts, plots" },
    { type: "figure", caption: "heap drawn by hand with shapes (the old way)", height: 80, size: "half", shapes: [
      { shape: "circle", cx: 50, cy: 12, r: 6, label: "9" }, { shape: "circle", cx: 25, cy: 40, r: 6, label: "5" }, { shape: "circle", cx: 75, cy: 40, r: 6, label: "8" },
      { shape: "line", x1: 50, y1: 18, x2: 25, y2: 34 }, { shape: "line", x1: 50, y1: 18, x2: 75, y2: 34 } ] },
    { type: "figure", caption: "block on an incline", height: 60, size: "half", shapes: [
      { shape: "polygon", points: [[10, 55], [90, 55], [90, 15]] }, { shape: "rect", x: 52, y: 26, w: 14, h: 10, label: "m" },
      { shape: "arrow", x1: 59, y1: 31, x2: 59, y2: 50, label: "mg", color: "red" }, { shape: "arc", cx: 10, cy: 55, r: 12, start: 0, end: 27, label: "θ" } ] },
    { type: "flowchart", direction: "TB", nodes: [{ id: "s", label: "Start", shape: "round" }, { id: "c", label: "low ≤ high?", shape: "diamond" }, { id: "m", label: "mid = (low + high) / 2" }, { id: "f", label: "A[mid] = target?", shape: "diamond" }, { id: "r", label: "return mid", shape: "round" }, { id: "n", label: "return -1", shape: "round" }], edges: [{ from: "s", to: "c" }, { from: "c", to: "m", label: "yes" }, { from: "c", to: "n", label: "no" }, { from: "m", to: "f" }, { from: "f", to: "r", label: "yes" }, { from: "f", to: "c", label: "no: move low or high" }] },
    { type: "plot", functions: [{ expr: "sin(x)", label: "$\\sin x$" }, { expr: "cos(x)", label: "$\\cos x$" }], xMin: -6.28, xMax: 6.28, xLabel: "x", yLabel: "y", size: "half" },
    { type: "plot", functions: [{ expr: "1/x", label: "$1/x$" }], xMin: -4, xMax: 4, size: "half" },
  ],
  text: [
    { type: "heading", text: "Maths and text" },
    { type: "math", latex: "\\sum_{k=0}^{\\lfloor \\log_2 n \\rfloor} \\left\\lceil \\frac{n}{2^{k+1}} \\right\\rceil O(k) = O(n) \\quad \\text{(build-heap is linear: most nodes sit near the bottom and sift down only a few levels)}", boxed: true, label: "a very wide equation" },
    { type: "steps", lines: [{ latex: "T(n) = 2T(n/2) + n", note: "merge sort recurrence" }, { latex: "= 4T(n/4) + 2n", note: "expand once more" }, { latex: "= 2^k T(n/2^k) + kn = n T(1) + n \\log_2 n \\text{ when } k = \\log_2 n", note: "a long final line" }] },
    { type: "table", headers: ["Sort", "Best", "Average", "Worst", "Space", "Stable"], rows: [["Heap", "$O(n\\log n)$", "$O(n\\log n)$", "$O(n\\log n)$", "$O(1)$", "no"], ["Merge", "$O(n\\log n)$", "$O(n\\log n)$", "$O(n\\log n)$", "$O(n)$", "yes"], ["Quick", "$O(n\\log n)$", "$O(n\\log n)$", "$O(n^2)$", "$O(\\log n)$", "no"]] },
    { type: "text", tone: "important", text: "Heap sort is **not stable**: equal keys can swap order, e.g. $[2_a, 2_b, 1]$." },
    { type: "math", latex: "\\\\log_2 1000 \\\\approx 10", label: "over-escaped LaTeX (should render normally)", size: "half" },
  ],
};

export function BoardGallery() {
  const [page, setPage] = useState("trees");
  const [run, setRun] = useState(0);
  const entries = useMemo<BoardEntry[]>(() => {
    const items = PAGES[page].map((raw) => sanitizeItem(raw)).filter((x): x is BoardItem => !!x);
    // run > 0 replays the drawing animation; otherwise everything is shown at once.
    const timings = run ? allocateTimings(items, items.length * 1800) : null;
    return items.map((item, i) => ({ key: `${page}:${run}:${i}`, item, timing: timings ? timings[i] : null }));
  }, [page, run]);
  const dropped = PAGES[page].length - entries.length;

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-2 text-[13px]">
        <b className="mr-2">Board gallery</b>
        {Object.keys(PAGES).map((p) => (
          <button key={p} onClick={() => (setPage(p), setRun(0))} className={p === page ? "rounded bg-white/15 px-2 py-1" : "rounded px-2 py-1 hover:bg-white/10"}>
            {p}
          </button>
        ))}
        <button onClick={() => setRun((r) => r + 1)} className="ml-auto rounded bg-white/10 px-2 py-1 hover:bg-white/15">
          Replay drawing
        </button>
        {dropped > 0 && <span className="text-red-400">{dropped} item(s) failed validation</span>}
      </div>
      <div className="min-h-0 flex-1">
        <Whiteboard entries={entries} paused={false} ink={[]} onInkChange={() => {}} selectedKey={null} onSelect={() => {}} pageKey={page} />
      </div>
    </div>
  );
}
