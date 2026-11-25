"""Joint statics: two muscle stacks on a hinge (spec 01, proposal Eq. 2 to 4).

Reference implementation; statics.js ports it line by line with the same names.
A stack is a pair (F, P): F active force at the reference strain (mN), P passive factor (sum of
the rings' factors; 1 per median ring). `p` is a joint dict from model.joint_params: eps, chi,
kappa, r, r_over_l, and the strain curves (strain, g_curve, p_curve) already scaled.
Sums are plain loops so both languages round the same way.
"""
import math
from bisect import bisect_right

TH_MAX = 1.2  # rad, scan range [-TH_MAX, TH_MAX] (spec 01)
N_SCAN = 241  # scan points (spec 01)
N_HALVINGS = 60  # bisection halvings (spec 01)
DEG = 180.0 / math.pi  # rad -> deg


def scan_grid():
    """TH_MAX * (k - m) / m: symmetric, point N_SCAN - 1 - k is exactly minus point k."""
    m = (N_SCAN - 1) // 2
    return [TH_MAX * (k - m) / m for k in range(N_SCAN)]


GRID = scan_grid()


def segment(e, xs):
    """Index i of the curve segment used at strain e: the first with xs[i] > e, clamped to 1..n-1,
    so outside the data the end segments extend (statics.js finds the same index by a loop)."""
    return min(max(bisect_right(xs, e), 1), len(xs) - 1)


def curve(e, xs, ys):
    """Piecewise-linear through the points (xs, ys), end segments extended (spec 01)."""
    i = segment(e, xs)
    return ys[i - 1] + (e - xs[i - 1]) * (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1])


def ring_forces(e, p):
    """At strain e: g, the active force relative to eps_ref (1 there), and the passive force of
    one median ring in mN, clipped at 0 for a slack ring. One segment lookup serves both."""
    xs = p["strain"]
    gs = p["g_curve"]
    ps = p["p_curve"]
    i = segment(e, xs)
    t = (e - xs[i - 1]) / (xs[i] - xs[i - 1])
    g = gs[i - 1] + t * (gs[i] - gs[i - 1])
    passive = ps[i - 1] + t * (ps[i] - ps[i - 1])
    return g, max(passive, 0.0)


def residual(th, A, B, stim, p):
    """Net torque at joint angle th (rad); zero at balance. stim is "A", "B" or None (rest)."""
    F_A, P_A = A
    F_B, P_B = B
    eA = p["eps"] - p["r_over_l"] * th
    eB = p["eps"] + p["r_over_l"] * th
    gA, pA = ring_forces(eA, p)
    gB, pB = ring_forces(eB, p)
    g0 = ring_forces(p["eps"], p)[0]
    if stim == "A":
        act = F_A * gA / g0 - p["chi"] * F_B * gB / g0
    elif stim == "B":
        act = p["chi"] * F_A * gA / g0 - F_B * gB / g0
    else:
        act = 0.0
    return p["r"] * (act + P_A * pA - P_B * pB) - p["kappa"] * th


def solve(A, B, stim, p, start):
    """Balance angle (rad) the joint reaches from `start`, and the number of balance points on
    the scan.

    The joint follows the net torque: from `start`, walk the scan points in the direction the
    residual pushes (zero counts as positive) to the first one whose sign differs, then halve
    that bracket N_HALVINGS times. A crossing reached this way is always stable. n_roots counts
    the sign changes between neighbouring scan points. No sign change in that direction (the
    joint runs to its stop): (nan, n_roots).
    """
    f = [residual(th, A, B, stim, p) for th in GRID]
    n_roots = 0
    for k in range(N_SCAN - 1):
        if (f[k] < 0) != (f[k + 1] < 0):
            n_roots += 1
    start_neg = residual(start, A, B, stim, p) < 0
    near = start  # last point with the start's sign
    far = math.nan  # first point beyond it with the other sign
    order = range(N_SCAN - 1, -1, -1) if start_neg else range(N_SCAN)
    for k in order:
        beyond = GRID[k] < start if start_neg else GRID[k] > start
        if beyond:
            if (f[k] < 0) != start_neg:
                far = GRID[k]
                break
            near = GRID[k]
    if math.isnan(far):
        return math.nan, n_roots
    for _ in range(N_HALVINGS):
        mid = 0.5 * (near + far)
        if (residual(mid, A, B, stim, p) < 0) == start_neg:
            near = mid
        else:
            far = mid
    return 0.5 * (near + far), n_roots


def rest(A, B, p):
    """Rest angle (rad), no stimulation, searched from 0; and its root count."""
    return solve(A, B, None, p, 0.0)


def swing(A, B, p):
    """Stimulate A, starting from the rest angle. swing = th_stim - th_rest in deg."""
    th_rest, n_rest = rest(A, B, p)
    th_stim, n_stim = solve(A, B, "A", p, th_rest)
    return {
        "swing": (th_stim - th_rest) * DEG,
        "rest": th_rest,
        "n_rest": n_rest,
        "n_stim": n_stim,
    }


def blocked_torque(A, B, p):
    """Torque with the joint held at 0 and A stimulated: r (F_A - chi F_B)."""
    F_A = A[0]
    F_B = B[0]
    return p["r"] * (F_A - p["chi"] * F_B)
