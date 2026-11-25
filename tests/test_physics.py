"""Physics invariants on the reference (spec 02): what must hold whatever the code does.

Parity proves the port matches the reference; these check the reference itself. Hypothesis,
200 examples each, derandomized so every run (make check, break_it.sh, mutmut) sees the same
examples. Generators from spec 02. No oracle and no parity here: mutmut runs this file alone.

Spec values (scan range, strain window) are written as literals, not imported, so a mutated
constant in the reference cannot fool its own test. Examples where the solver finds no balance
point inside the scan (joint at its stop: returns nan) are skipped with assume().
"""
import math
import pathlib
import sys
from contextlib import contextmanager

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from hypothesis import assume, given, settings  # noqa: E402
from hypothesis import strategies as st  # noqa: E402

import model  # noqa: E402
from model import LOADS, PARAMS, SHIELDS  # noqa: E402
from rng import Rng  # noqa: E402
from statics import blocked_torque, residual, rest, solve, swing  # noqa: E402

EXAMPLES = settings(max_examples=200, deadline=None, derandomize=True, database=None)

# generators (spec 02)
n_rings_s = st.integers(1, 4)
force_s = st.floats(0.5, 20.0)  # mN
passive_s = st.floats(0.25, 5.0)  # passive factor: 1 per median ring (reference script's range)
eps_s = st.floats(0.05, 0.37)
chi_s = st.floats(0.0, 0.9)
kappa_s = st.floats(0.5, 100.0)
stack_s = st.tuples(force_s, passive_s)
start_s = st.floats(-1.2, 1.2)
seed_s = st.integers(1, 2**32 - 1)
load_s = st.sampled_from(LOADS)
shield_s = st.sampled_from(SHIELDS)


def joint(eps, chi, kappa):
    """A joint dict with the model's curves and geometry, and the given eps, chi, kappa."""
    p = model.joint_params("light", "unshielded")
    p.update(eps=eps, chi=chi, kappa=kappa)
    return p


def same_angle(t1, t2, tol):
    """Both nan (no balance point in the scan), or within tol."""
    if math.isnan(t1) or math.isnan(t2):
        return math.isnan(t1) and math.isnan(t2)
    return abs(t1 - t2) <= tol


@contextmanager
def preset(sigma_R, sigma_A, sigma_C):
    """A temporary spread preset named "test" (PARAMS keeps its own three)."""
    PARAMS["presets"]["test"] = {"sigma_R": sigma_R, "sigma_A": sigma_A, "sigma_C": sigma_C}
    try:
        yield "test"
    finally:
        del PARAMS["presets"]["test"]


def page_swings(builds, name, load, shield, n_rings, rebuilds=None):
    """Swing of each build (deg); with rebuilds, of each rebuilt build."""
    p = model.joint_params(load, shield)
    out = []
    for i, bz in enumerate(builds):
        A, B = model.build_stacks(bz, n_rings, name, None if rebuilds is None else rebuilds[i])
        out.append(swing(A, B, p)["swing"])
    return out


def independent_roots(A, B, stim, p, n=1001):
    """Sign changes on a 1001-point grid over the spec's [-1.2, 1.2], built separately from
    statics.GRID; zero counts as positive, as in the spec's bracket rule."""
    grid = [-1.2 + 2.4 * k / (n - 1) for k in range(n)]
    f = [residual(th, A, B, stim, p) for th in grid]
    return [0.5 * (grid[k] + grid[k + 1]) for k in range(n - 1) if (f[k] < 0) != (f[k + 1] < 0)]


@EXAMPLES
@given(a=force_s, b=passive_s, eps=eps_s, chi=chi_s)
def test_I1_equal_stacks_ring_count_cancels(a, b, eps, chi):
    """Equal deterministic stacks, kappa = 1e-9: N rings scale every torque alike, so the swing
    is the same for N = 1..4 (1e-6 deg)."""
    p = joint(eps, chi, 1e-9)
    swings = [swing((n * a, n * b), (n * a, n * b), p)["swing"] for n in range(1, 5)]
    assume(math.isfinite(swings[0]))
    for s in swings[1:]:
        assert abs(s - swings[0]) <= 1e-6


@EXAMPLES
@given(A=stack_s, B=stack_s, eps=eps_s, chi=chi_s, kappa=kappa_s, start=start_s)
def test_I2_mirror_stimulation(A, B, eps, chi, kappa, start):
    """solve(A, B, "A") == -solve(B, A, "B"): swap the stacks and the side, mirror the angle
    (and the start angle); same root count (1e-9 rad)."""
    p = joint(eps, chi, kappa)
    th_a, n_a = solve(A, B, "A", p, start)
    th_b, n_b = solve(B, A, "B", p, -start)
    assert n_a == n_b
    assert same_angle(th_a, -th_b, 1e-9)


@EXAMPLES
@given(A=stack_s, B=stack_s, eps=eps_s, chi=chi_s, kappa=kappa_s)
def test_I3_rest_mirror_and_equal_stacks_at_zero(A, B, eps, chi, kappa):
    """rest(A, B) == -rest(B, A), and equal stacks rest at 0 (1e-9 rad)."""
    p = joint(eps, chi, kappa)
    th_ab, n_ab = rest(A, B, p)
    th_ba, n_ba = rest(B, A, p)
    assert n_ab == n_ba
    assert same_angle(th_ab, -th_ba, 1e-9)
    th_aa, _ = rest(A, A, p)
    assert abs(th_aa) <= 1e-9


@EXAMPLES
@given(S=stack_s, eps=eps_s, kappa=kappa_s, chi1=chi_s, chi2=chi_s)
def test_I4_swing_non_increasing_in_crosstalk(S, eps, kappa, chi1, chi2):
    """Equal stacks: more crosstalk (chi) never gives a larger swing (1e-9 deg)."""
    lo, hi = sorted((chi1, chi2))
    s_lo = swing(S, S, joint(eps, lo, kappa))["swing"]
    s_hi = swing(S, S, joint(eps, hi, kappa))["swing"]
    assume(math.isfinite(s_lo) and math.isfinite(s_hi))
    assert s_hi <= s_lo + 1e-9


@EXAMPLES
@given(a=force_s, b=passive_s, eps=eps_s, chi=chi_s, kappa=st.floats(10.0, 100.0))
def test_I5_more_rings_more_swing_under_load(a, b, eps, chi, kappa):
    """Model claim: equal rings, kappa >= 10: the swing strictly increases with N."""
    p = joint(eps, chi, kappa)
    swings = [swing((n * a, n * b), (n * a, n * b), p)["swing"] for n in range(1, 5)]
    assume(all(math.isfinite(s) for s in swings))
    for s1, s2 in zip(swings, swings[1:]):
        assert s2 > s1


@EXAMPLES
@given(A=stack_s, B=stack_s, eps=eps_s, chi=chi_s)
def test_I6_stiff_hinge_gives_blocked_torque(A, B, eps, chi):
    """kappa = 1e6: kappa * swing (rad) -> blocked torque r (F_A - chi F_B) (relative 1e-3)."""
    kappa = 1e6
    p = joint(eps, chi, kappa)
    s = swing(A, B, p)
    bt = blocked_torque(A, B, p)
    assert abs(kappa * math.radians(s["swing"]) - bt) <= 1e-3 * abs(bt)


@EXAMPLES
@given(A=stack_s, B=stack_s, eps=eps_s, chi=chi_s, kappa=kappa_s, c=st.floats(0.1, 10.0))
def test_I7_scaling_forces_and_stiffness_keeps_angles(A, B, eps, chi, kappa, c):
    """Scale all forces and kappa by c: rest and stimulated angles unchanged (1e-9 rad)."""
    p = joint(eps, chi, kappa)
    pc = joint(eps, chi, c * kappa)
    Ac = (c * A[0], c * A[1])
    Bc = (c * B[0], c * B[1])
    th0, n0 = rest(A, B, p)
    th0c, n0c = rest(Ac, Bc, pc)
    assert n0 == n0c
    assert same_angle(th0, th0c, 1e-9)
    assume(math.isfinite(th0))
    th1, n1 = solve(A, B, "A", p, th0)
    th1c, n1c = solve(Ac, Bc, "A", pc, th0c)
    assert n1 == n1c
    assert same_angle(th1, th1c, 1e-9)


@EXAMPLES
@given(A=stack_s, B=stack_s, eps=eps_s, chi=chi_s, kappa=kappa_s,
       stim=st.sampled_from([None, "A", "B"]), start=start_s)
def test_I8_residual_at_returned_angle(A, B, eps, chi, kappa, stim, start):
    """The returned angle balances the joint: |residual| < 1e-9."""
    p = joint(eps, chi, kappa)
    th, _ = solve(A, B, stim, p, start)
    assume(math.isfinite(th))
    assert abs(residual(th, A, B, stim, p)) < 1e-9


@EXAMPLES
@given(A=stack_s, B=stack_s, eps=eps_s, chi=chi_s, kappa=kappa_s,
       stim=st.sampled_from([None, "A", "B"]), start=start_s)
def test_I9_root_count_matches_independent_grid(A, B, eps, chi, kappa, stim, start):
    """n_roots equals the sign changes on an independent 1001-point grid (exact); with one root,
    the solved angle matches it (3e-3 rad)."""
    p = joint(eps, chi, kappa)
    th, n = solve(A, B, stim, p, start)
    found = independent_roots(A, B, stim, p)
    assert n == len(found)
    if n == 1:
        assert abs(th - found[0]) <= 3e-3


def test_I9_hand_built_three_roots():
    """Random draws almost never give several roots (spec 02); with the published curves they need
    a soft hinge and a high pre-stretch. This joint (pre-stretch 0.5, chi 0.4, kappa 0.2) has three
    with A stimulated: stable near -0.99, unstable near +0.33, stable near +0.86 rad. From any start
    the solver must follow the torque to the next root in that direction, a stable one. From rest
    (about +0.54) that is +0.86, not the nearer unstable +0.33 the old nearest-bracket rule took."""
    p = joint(0.5, 0.4, 0.2)
    A = (10.0, 1.0)
    B = (30.0, 0.5)
    found = independent_roots(A, B, "A", p)
    assert len(found) == 3
    th_rest, n_rest = rest(A, B, p)
    assert n_rest == 1
    for start in (-1.1, -0.5, 0.2, th_rest, 0.6, 1.1):
        if residual(start, A, B, "A", p) < 0:  # torque pushes down: next root below
            expected = max(r for r in found if r < start)
        else:  # pushes up: next root above
            expected = min(r for r in found if r > start)
        th, n = solve(A, B, "A", p, start)
        assert n == 3
        assert abs(th - expected) <= 3e-3, f"from {start:+.3f}: {th:+.4f}, expected {expected:+.4f}"
        slope = (residual(th + 1e-6, A, B, "A", p) - residual(th - 1e-6, A, B, "A", p)) / 2e-6
        assert slope < 0, f"from {start:+.3f}: unstable root {th:+.4f}"
    th, _ = solve(A, B, "A", p, th_rest)
    assert abs(th - found[2]) <= 3e-3  # the stable root near +0.86, not the unstable +0.33
    # mirrored: stacks swapped, B stimulated, every start negated -> every root negated.
    # Walking down from a start must not reach a root by walking up (or the other way).
    for start in (-1.1, -0.5, 0.2, th_rest, 0.6, 1.1):
        th, _ = solve(A, B, "A", p, start)
        th_m, n_m = solve(B, A, "B", p, -start)
        assert n_m == 3
        assert abs(th_m + th) <= 1e-9, f"mirror of {start:+.3f}: {th_m:+.4f} vs {-th:+.4f}"


@EXAMPLES
@given(seed=seed_s, n_rings=n_rings_s, load=load_s, shield=shield_s)
def test_I10_no_spread_no_scatter(seed, n_rings, load, shield):
    """All sigmas 0: the 50 page builds swing identically (exact)."""
    builds = model.draw_builds(Rng(seed), PARAMS["n_builds_page"])
    with preset(0.0, 0.0, 0.0) as name:
        swings = page_swings(builds, name, load, shield, n_rings)
    assert len(set(swings)) == 1


@EXAMPLES
@given(seed=seed_s, n_rings=n_rings_s, load=load_s, shield=shield_s,
       sigma_R=st.floats(0.0, 0.3), sigma_C=st.floats(0.0, 0.3))
def test_I11_no_assembly_spread_rebuild_changes_nothing(seed, n_rings, load, shield, sigma_R,
                                                        sigma_C):
    """sigma_A = 0: rebuilding (new u_A, same rings and combination) leaves every swing
    unchanged (exact)."""
    rng = Rng(seed)
    builds = model.draw_builds(rng, PARAMS["n_builds_page"])
    rebuilds = model.draw_rebuilds(rng, PARAMS["n_builds_page"])
    with preset(sigma_R, 0.0, sigma_C) as name:
        before = page_swings(builds, name, load, shield, n_rings)
        after = page_swings(builds, name, load, shield, n_rings, rebuilds)
    assert before == after


def relative_width(swings):
    """(q90 - q10) / median, as in the reference scripts."""
    q10 = model.quantile(swings, 0.1)
    q50 = model.quantile(swings, 0.5)
    q90 = model.quantile(swings, 0.9)
    return (q90 - q10) / q50


def test_I12_rings_preset_more_rings_narrower_spread():
    """Model claim: rings preset, relative width at N = 4 below N = 1; 1500 builds, seeds 1-3,
    page default load and shielding (heavy, unshielded)."""
    for seed in (1, 2, 3):
        builds = model.seed_builds(seed, 1500)
        w1 = relative_width(page_swings(builds, "rings", "heavy", "unshielded", 1))
        w4 = relative_width(page_swings(builds, "rings", "heavy", "unshielded", 4))
        assert w4 < w1, f"seed {seed}: width N=4 {w4:.3f} not below N=1 {w1:.3f}"


@EXAMPLES
@given(seed=seed_s, n_rings=n_rings_s, sigma_A=st.floats(0.05, 0.3))
def test_I13_rebuild_changes_only_the_assembly(seed, n_rings, sigma_A):
    """Assembly spread > 0: rebuilding (a new u_A) changes the active force F of both stacks,
    by exp(sigma_A (z_A' - z_A)) exactly, and leaves the passive factor P unchanged."""
    rng = Rng(seed)
    builds = model.draw_builds(rng, 3)
    rebuilds = model.draw_rebuilds(rng, 3)
    with preset(0.2, sigma_A, 0.1) as name:
        for bz, rz in zip(builds, rebuilds):
            before = model.build_stacks(bz, n_rings, name)
            after = model.build_stacks(bz, n_rings, name, rz)
            for side, k in (("A", 0), ("B", 1)):
                ratio = math.exp(sigma_A * (rz[side] - bz[side]["zA"]))
                assert after[k][1] == before[k][1]
                assert math.isclose(after[k][0], before[k][0] * ratio, rel_tol=1e-12)


@EXAMPLES
@given(seed=seed_s, n_rings=n_rings_s, sigma_R=st.floats(0.0, 0.3), sigma_A=st.floats(0.0, 0.3),
       sigma_C=st.floats(0.0, 0.3))
def test_I14_stack_is_spec_formula(seed, n_rings, sigma_R, sigma_A, sigma_C):
    """stack() is spec 01's formula, typed here again: F = exp(sigma_A z_A + sigma_C z_C) *
    sum of exp(log 2 + sigma_R z_a) over the first N rings; P = sum of exp(sigma_R z_b)."""
    z = model.draw_stack_z(Rng(seed))
    with preset(sigma_R, sigma_A, sigma_C) as name:
        F, P = model.stack(z, n_rings, name, z["zA"])
    eta = math.exp(sigma_A * z["zA"] + sigma_C * z["zC"])
    F_spec = eta * sum(math.exp(math.log(2.0) + sigma_R * z["za"][j]) for j in range(n_rings))
    P_spec = sum(math.exp(sigma_R * z["zb"][j]) for j in range(n_rings))
    assert math.isclose(F, F_spec, rel_tol=1e-12)
    assert math.isclose(P, P_spec, rel_tol=1e-12)


def test_I15_quantile_is_type_7():
    """Type 7 quantile (linear between order statistics) on a small unsorted example."""
    xs = [40.0, 10.0, 30.0, 20.0]
    for q, expected in ((0.0, 10.0), (0.1, 13.0), (0.5, 25.0), (0.9, 37.0), (1.0, 40.0)):
        assert math.isclose(model.quantile(xs, q), expected, rel_tol=1e-12), q


# spec 01's published curves (Fig. 2D means, C20), typed here again
STRAIN_PCT = (0, 3.83, 15.2, 26.5, 37.9, 49.2, 60.5, 71.9, 83.2, 94.5, 105.9)
ACTIVE_MN = (1.87, 2.15, 2.32, 2.39, 2.40, 2.28, 2.03, 1.82, 1.58, 1.41, 1.07)
PASSIVE_MN = (0.57, 0.91, 1.37, 2.05, 2.90, 3.81, 5.19, 6.32, 7.61, 8.80, 10.34)


def test_I16_curves_pass_through_the_published_points():
    """At each published strain, g = active / active(0.24) and the passive force of a median ring
    = passive * 2.0 / active(0.24) (spec 01); g(0.24) = 1."""
    p = joint(0.24, 0.0, 1.0)
    a_ref = 2.32 + (24.0 - 15.2) * (2.39 - 2.32) / (26.5 - 15.2)  # active at 0.24, by hand
    from statics import ring_forces
    assert math.isclose(ring_forces(0.24, p)[0], 1.0, rel_tol=1e-12)
    for e, a, b in zip(STRAIN_PCT, ACTIVE_MN, PASSIVE_MN):
        g, passive = ring_forces(e / 100, p)
        assert math.isclose(g, a / a_ref, rel_tol=1e-9), e
        assert math.isclose(passive, b * 2.0 / a_ref, rel_tol=1e-9), e


def test_I17_settings_map_to_spec_parameters():
    """The page's settings map to spec 01's values, typed here again: load light/heavy ->
    kappa 2/30; shielding off/on -> chi 1/2.9 and 1/12."""
    for load, kappa in (("light", 2.0), ("heavy", 30.0)):
        for shield, chi in (("unshielded", 1 / 2.9), ("shielded", 1 / 12)):
            p = model.joint_params(load, shield)
            assert p["kappa"] == kappa and p["chi"] == chi, (load, shield)
