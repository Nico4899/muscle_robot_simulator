"""Joint statics: two muscle stacks on a hinge (spec 01, proposal Eq. 2 to 4).

Reference implementation; statics.js ports it line by line with the same names.
A stack is a pair (F, P): F active force at the reference strain (mN), P passive amplitude (mN).
`p` is a joint dict from model.joint_params: eps, chi, kappa, r, r_over_l, eps0, w, c.
Squares are written as d * d and sums as plain loops so both languages round the same way.
"""
import math

TH_MAX = 1.2  # rad, scan range [-TH_MAX, TH_MAX] (spec 01)
N_SCAN = 241  # scan points (spec 01)
N_HALVINGS = 60  # bisection halvings (spec 01)
DEG = 180.0 / math.pi  # rad -> deg


def scan_grid():
    """TH_MAX * (k - m) / m: symmetric, point N_SCAN - 1 - k is exactly minus point k."""
    m = (N_SCAN - 1) // 2
    return [TH_MAX * (k - m) / m for k in range(N_SCAN)]


GRID = scan_grid()


def g(e, p):
    """Active force-length curve: Gaussian, 1 at the peak strain eps0, width w."""
    d = e - p["eps0"]
    return math.exp(-(d * d) / (2.0 * p["w"] * p["w"]))


def h(e, p):
    """Passive force-length curve: exp(c e) - 1."""
    return math.exp(p["c"] * e) - 1.0


def residual(th, A, B, stim, p):
    """Net torque at joint angle th (rad); zero at balance. stim is "A", "B" or None (rest)."""
    F_A, P_A = A
    F_B, P_B = B
    eA = p["eps"] - p["r_over_l"] * th
    eB = p["eps"] + p["r_over_l"] * th
    g0 = g(p["eps"], p)
    if stim == "A":
        act = F_A * g(eA, p) / g0 - p["chi"] * F_B * g(eB, p) / g0
    elif stim == "B":
        act = p["chi"] * F_A * g(eA, p) / g0 - F_B * g(eB, p) / g0
    else:
        act = 0.0
    return p["r"] * (act + P_A * h(eA, p) - P_B * h(eB, p)) - p["kappa"] * th


def solve(A, B, stim, p, start):
    """Balance angle (rad) nearest `start`, and the number of balance points on the scan.

    A bracket is a pair of neighbouring scan points whose residuals differ in sign (zero counts
    as positive, so an exact zero is counted once). Take the bracket whose midpoint is nearest
    `start` (the first one on a tie) and halve it N_HALVINGS times. No bracket: (nan, 0).
    """
    f = [residual(th, A, B, stim, p) for th in GRID]
    best = -1
    best_d = math.inf
    n_roots = 0
    for k in range(N_SCAN - 1):
        if (f[k] < 0) != (f[k + 1] < 0):
            n_roots += 1
            d = abs(0.5 * (GRID[k] + GRID[k + 1]) - start)
            if d < best_d:
                best = k
                best_d = d
    if best < 0:
        return math.nan, 0
    lo = GRID[best]
    hi = GRID[best + 1]
    lo_neg = f[best] < 0
    for _ in range(N_HALVINGS):
        mid = 0.5 * (lo + hi)
        if (residual(mid, A, B, stim, p) < 0) == lo_neg:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi), n_roots


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
