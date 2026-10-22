from helper.mathcheck import check_equation, check_steps, latex_to_sympy


def msgs(findings):
    return [f.message for f in findings]


def test_correct_numeric_chains_pass():
    assert check_equation("a", r"Z = \frac{fB}{d} = \frac{800 \cdot 120}{100} = 960") == []
    assert check_equation("a", r"\log_2 1000 \approx 9.97") == []
    assert check_equation("a", r"\sqrt{2} = 1.414") == []
    assert check_equation("a", r"v = 3 \times 10^{8}\,\text{m/s}") == []
    assert check_equation("a", r"\sin 30^\circ = 0.5") == []
    assert check_equation("a", r"F = ma = 2 \times 9.8 = 19.6 \text{ N}") == []
    # A unit with a power must not raise the number to that power (a false alarm found in the evaluation).
    assert check_equation("a", r"a = \frac{6.54}{2} = 3.27 \text{ m/s}^2") == []
    assert check_equation("a", r"E = 4.2 \times 10^{3}\,\mathrm{J\,kg^{-1}}") == []


def test_wrong_arithmetic_is_caught():
    f = check_equation("b1", r"mid = \frac{0+6}{2} = 2")
    assert len(f) == 1 and "left side is 3" in f[0].message
    assert check_equation("b2", r"\log_2 1000 \approx 100")
    assert check_equation("b3", r"Z = \frac{800 \cdot 120}{100} = 96")


def test_unreadable_or_symbolic_sides_are_skipped_not_guessed():
    assert check_equation("c", r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}") == []
    assert check_equation("c", r"T(n) = 2T(n/2) + n") == []
    assert check_equation("c", r"\int_0^1 x\,dx = \frac{1}{2}") == []
    assert check_equation("c", r"2x + 3 = 7") == []


def test_derivation_lines_must_follow():
    assert check_steps("s", [r"(x+2)^2", r"= x^2 + 4x + 4"]) == []
    bad = check_steps("s", [r"(x+2)^2", r"= x^2 + 2x + 4"])
    assert len(bad) == 1 and "doesn't follow" in bad[0].message
    assert check_steps("s", [r"mid = \frac{0+6}{2}", r"= 2"])
    # Recurrences use an unknown function: not compared.
    assert check_steps("s", [r"T(n) = 2T(n/2) + n", r"= 4T(n/4) + 2n"]) == []


def test_code_cannot_get_through():
    assert latex_to_sympy("__import__('os').system('dir')") is None
    assert latex_to_sympy(r"pi.evalf(100000)") is None
    assert latex_to_sympy(r"2^{99999999}") is None
    assert latex_to_sympy(r"\href{x}{1}") is None
