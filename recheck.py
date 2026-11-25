"""Independent recheck (spec 04): shield_ratio, the three rescue rates and I1's cancellation,
recomputed from spec 01 alone with NumPy's default RNG and scipy's brentq.

Does NOT import the repo's modules: the physics below is typed from spec 01 again, with its own
random numbers, so a mistake shared by statics.py and statics.js still shows here as a mismatch.
From oracle.json it reads only the values it compares against and the headline build count.
Tolerances (spec 04): ratios 3 % relative; rates max(0.03, 3 x combined binomial SE).
"""
import json
import math
import sys
from bisect import bisect

import numpy as np
from scipy.optimize import brentq

# spec 01, PARAMS table and equations (typed from the spec, not imported)
EPS = 0.24  # pre-stretch
# published mean curves of 4 single rings, Fig. 2D (C20): strain %, active mN, passive mN
STRAIN = [x / 100 for x in (0, 3.83, 15.2, 26.5, 37.9, 49.2, 60.5, 71.9, 83.2, 94.5, 105.9)]
ACTIVE = [1.87, 2.15, 2.32, 2.39, 2.40, 2.28, 2.03, 1.82, 1.58, 1.41, 1.07]
PASSIVE = [0.57, 0.91, 1.37, 2.05, 2.90, 3.81, 5.19, 6.32, 7.61, 8.80, 10.34]
EPS_REF, A0 = 0.24, 2.0  # curves' reference strain; a median ring's active force there (mN)
R, R_OVER_L = 2.0, 0.25  # moment arm; strain per rad
CHI_OFF, CHI_ON = 1 / 2.9, 1 / 12  # crosstalk unshielded / shielded
KAPPA_LIGHT, KAPPA_HEAVY = 2.0, 30.0  # hinge stiffness
PRESETS = {"rings": (0.25, 0.035, 0.035), "assembly": (0.08, 0.25, 0.0),
           "combination": (0.08, 0.0, 0.25)}  # (sigma_R, sigma_A, sigma_C)
TARGET_DEG = 8.0
N_RINGS = 4  # shield_ratio and rescue: 4 rings, heavy (spec 01)
TH_LIMIT = 1.2  # rad, the solver's range

SEED = 2026  # any seed: NumPy's stream is unrelated to the oracle's mulberry32 anyway
RATIO_TOL = 0.03
RATE_FLOOR, RATE_N_SE = 0.03, 3.0
I1_TOL_DEG = 1e-6


def interp(e, xs, ys):
    """Linear between the points; beyond them the end segments continue (spec 01)."""
    k = min(max(bisect(xs, e), 1), len(xs) - 1)
    x0, x1, y0, y1 = xs[k - 1], xs[k], ys[k - 1], ys[k]
    return y0 + (y1 - y0) * (e - x0) / (x1 - x0)


ACTIVE_REF = interp(EPS_REF, STRAIN, ACTIVE)


def g(e):
    """Active force relative to the reference strain."""
    return interp(e, STRAIN, ACTIVE) / ACTIVE_REF


def p(e):
    """Passive force of a median ring (mN), scaled to A0 active at EPS_REF; 0 when slack."""
    return max(0.0, interp(e, STRAIN, PASSIVE) * A0 / ACTIVE_REF)


def torque(th, FA, PA, FB, PB, chi, kappa, stimulated):
    """Net torque on the hinge, A stimulated or at rest (spec 01, Balance)."""
    eA, eB = EPS - R_OVER_L * th, EPS + R_OVER_L * th
    active = (FA * g(eA) - chi * FB * g(eB)) / g(EPS) if stimulated else 0.0
    return R * (active + PA * p(eA) - PB * p(eB)) - kappa * th


def angle(FA, PA, FB, PB, chi, kappa, stimulated):
    """Balance angle by brentq over the whole range (one balance point in these settings)."""
    return brentq(torque, -TH_LIMIT, TH_LIMIT, args=(FA, PA, FB, PB, chi, kappa, stimulated),
                  xtol=1e-14)


class Draws:
    """Standard normals for n builds x 2 stacks; rebuilds get a fresh u_A."""

    def __init__(self, n, seed):
        rng = np.random.default_rng(seed)
        self.za = rng.standard_normal((n, 2, N_RINGS))
        self.zb = rng.standard_normal((n, 2, N_RINGS))
        self.zA = rng.standard_normal((n, 2))
        self.zC = rng.standard_normal((n, 2))
        self.zA_rebuild = rng.standard_normal((n, 2))

    def stacks(self, preset, rebuilt=False):
        """F (n, 2) and P (n, 2): F = eta * sum(a), P = sum(b) (passive factors), eta = exp(u_A + u_C)."""
        sR, sA, sC = PRESETS[preset]
        zA = self.zA_rebuild if rebuilt else self.zA
        F = np.exp(sA * zA + sC * self.zC) * np.exp(np.log(A0) + sR * self.za).sum(axis=2)
        P = np.exp(sR * self.zb).sum(axis=2)
        return F, P


def rest_angles(P, kappa):
    return np.array([angle(0.0, p[0], 0.0, p[1], 0.0, kappa, False) for p in P])


def swings_deg(F, P, rest, chi, kappa):
    stim = np.array([angle(f[0], p[0], f[1], p[1], chi, kappa, True) for f, p in zip(F, P)])
    return np.degrees(stim - rest)


def main():
    oracle = json.load(open("oracle.json", encoding="utf-8"))
    n = oracle["params"]["n_builds_headline"]
    draws = Draws(n, SEED)
    lines, ok_all = [], True

    def report(ok, text):
        nonlocal ok_all
        ok_all &= ok
        lines.append(f"{'ok  ' if ok else 'FAIL'} {text}")

    # the oracle's PARAMS still say what spec 01 says
    op = oracle["params"]
    typed = {"eps": EPS, "eps_ref": EPS_REF, "a0": A0, "r": R, "r_over_l": R_OVER_L,
             "chi_off": CHI_OFF, "chi_on": CHI_ON, "kappa_light": KAPPA_LIGHT,
             "kappa_heavy": KAPPA_HEAVY, "target_deg": TARGET_DEG}
    drift = [k for k, v in typed.items() if not math.isclose(op[k], v, rel_tol=1e-12)]
    drift += [k for k, v in (("strain", STRAIN), ("active", ACTIVE), ("passive", PASSIVE))
              if len(op[k]) != len(v) or not all(math.isclose(a, b, rel_tol=1e-12)
                                                 for a, b in zip(op[k], v))]
    drift += [p for p, s in PRESETS.items()
              if tuple(op["presets"][p][k] for k in ("sigma_R", "sigma_A", "sigma_C")) != s]
    report(not drift, f"oracle PARAMS match spec 01" + (f": differ in {drift}" if drift else ""))

    # shield_ratio: rings preset, 4 rings, heavy
    F, P = draws.stacks("rings")
    rest = rest_angles(P, KAPPA_HEAVY)
    off = np.median(swings_deg(F, P, rest, CHI_OFF, KAPPA_HEAVY))
    on = np.median(swings_deg(F, P, rest, CHI_ON, KAPPA_HEAVY))
    ratio = on / off
    rel = abs(ratio - oracle["shield_ratio"]) / oracle["shield_ratio"]
    report(rel <= RATIO_TOL, f"shield_ratio {ratio:.3f} vs oracle {oracle['shield_ratio']:.3f}: "
           f"{rel:.1%} <= {RATIO_TOL:.0%}")

    # rescue rates: 4 rings, heavy, unshielded; rebuild = new u_A, same rings and u_C
    for preset in PRESETS:
        F, P = draws.stacks(preset)
        rest = rest_angles(P, KAPPA_HEAVY)  # P does not change on rebuild, nor the rest angle
        missed = swings_deg(F, P, rest, CHI_OFF, KAPPA_HEAVY) < TARGET_DEG
        F2, _ = draws.stacks(preset, rebuilt=True)
        again = swings_deg(F2[missed], P[missed], rest[missed], CHI_OFF, KAPPA_HEAVY)
        n_missed = int(missed.sum())
        rate = float((again >= TARGET_DEG).mean()) if n_missed else 0.0
        se = math.sqrt(rate * (1 - rate) / n_missed) if n_missed else 0.0
        o = oracle["rescue"][preset]
        tol = max(RATE_FLOOR, RATE_N_SE * math.hypot(se, o["rescued_se"]))
        diff = abs(rate - o["rescued"])
        report(diff <= tol, f"rescue {preset:11s} {rate:.3f}±{se:.3f} vs oracle "
               f"{o['rescued']:.3f}±{o['rescued_se']:.3f}: |diff| {diff:.3f} <= {tol:.3f}")

    # I1: equal deterministic stacks, kappa ~ 0: the ring count cancels
    sw = []
    for k in range(1, N_RINGS + 1):
        FA, PA = k * A0, k * 1.0  # k median rings: passive factor 1 each
        th0 = angle(FA, PA, FA, PA, CHI_OFF, 1e-9, False)
        th1 = angle(FA, PA, FA, PA, CHI_OFF, 1e-9, True)
        sw.append(math.degrees(th1 - th0))
    spread = max(sw) - min(sw)
    report(spread <= I1_TOL_DEG, f"I1 cancellation: swing {sw[0]:.4f} deg for 1-4 rings, "
           f"spread {spread:.1e} <= {I1_TOL_DEG:.0e} deg")

    print("\n".join(lines))
    print(f"recheck: {'ok' if ok_all else 'FAILED'}, {n} builds, NumPy seed {SEED}, brentq")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
