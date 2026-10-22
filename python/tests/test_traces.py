from helper.traces import detect, run


def test_detects_the_algorithm_mentioned_first_and_most_specific():
    assert detect("Heap sort in action: build a max-heap, then extract") == "heap_sort"
    assert detect("Sorting: bubble sort vs merge sort") == "bubble_sort"
    assert detect("Graph traversal with BFS") == "bfs"
    assert detect("Photosynthesis") is None


def test_every_sort_really_sorts_and_records_states():
    data = [5, 2, 9, 1, 7, 3]
    for name in ("heap_sort", "bubble_sort", "selection_sort", "insertion_sort", "merge_sort", "quick_sort"):
        t = run(name, data)
        assert t and t["steps"][-1] == "Sorted: [1, 2, 3, 5, 7, 9]", name
        assert t["states"], name


def test_heap_sort_trace_matches_the_textbook():
    t = run("heap_sort", [9, 5, 8, 4, 2, 7, 6])
    # Already a max-heap; the first extraction swaps 9 with the LAST element (6), then sifts 6 down past 8 and 7.
    assert "Swap the root 9 with the last heap element A[6]=6 -> [6, 5, 8, 4, 2, 7, 9]" in t["text"]
    assert "[8, 5, 7, 4, 2, 6, 9]" in t["text"]


def test_binary_search_steps():
    t = run("binary_search", [3, 7, 12, 18, 23, 27, 31], 23)
    assert t["steps"][1].startswith("low=0, high=6: mid=(0+6)//2=3, A[3]=18 < 23")
    assert "found at index 4" in t["steps"][-1]


def test_inputs_are_capped_and_cleaned():
    assert run("bubble_sort", list(range(40, 0, -1)))["input"] == list(range(40, 28, -1))
    assert run("bubble_sort", ["x", "y"])["input"] == [5, 2, 9, 1, 7, 3]
