# Lesson accuracy with and without the Python tools (2026-10-22)

8 topics, the worked-example part of each, written twice from the same plan. Counts are for the final part, after the fact-check's corrections.

> **Correction:** the one "wrong equation" below (Newton, without Python tools) was a false alarm in the checker itself: `3.27 \text{ m/s}^2` had its unit removed but its power kept. Fixed and re-scored: **0 wrong of 33** (without) and **0 wrong of 16** (with). The trace column here also missed 3-element arrays; see the sorting re-run.

| | Wrong equations (SymPy) | Wrong algorithm states (real run) | Fact-check fixes | First beat (avg) |
|---|---|---|---|---|
| Without Python tools | 1 of 33 | 0 of 3 | 5 | 11.4 s |
| With Python tools | 0 of 16 | 0 of 2 | 1 | 7.3 s |

## Per topic

| Topic | Part | Without: wrong eq. / trace | With: wrong eq. / trace |
|---|---|---|---|
| Heap sort | Algorithm Derivation: Build-Max-Heap & Extract-Max | 0/3 · 0/0 | 0/2 · 0/0 |
| Projectile motion | Introduction & Component Analysis | 0/1 · n/a | 0/1 · n/a |
| Bubble sort | Bubble Sort Algorithm: Step-by-Step | 0/9 · 0/0 | 0/1 · 0/0 |
| Ohm's law and series and parallel resistors | Strategic Problem Solving & Common Traps | 0/7 · n/a | 0/4 · n/a |
| Insertion sort | Algorithm Mechanics and Complexity Analysis | 0/5 · 0/0 | 0/3 · 0/0 |
| Compound interest | Unlocking the Secret Formula | 0/3 · n/a | 0/1 · n/a |
| Quick sort | Worked Example and Common Pitfalls | 0/1 · 0/3 | 0/1 · 0/2 |
| Newton's second law with friction | Problem-Solving & Common Traps | 1/4 · n/a | 0/3 · n/a |
