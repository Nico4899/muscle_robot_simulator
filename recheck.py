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

import numpy as np
from scipy.optimize import brentq

# spec 01, PARAMS table and equations (typed from the spec, not imported)
EPS, EPS0, W, C = 0.24, 0.26, 0.15, 8.0  # pre-stretch; active peak and width; passive rate
A0, B0 = 2.0, 0.084  # per ring: active force at the reference strain, passive amplitude (mN)
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


def g(e):
    return math.exp(-((e - EPS0) ** 2) / (2 * W ** 2))


def h(e):
    return math.exp(C * e) - 1


def torque(th, FA, PA, FB, PB, chi, kappa, stimulated):
    """Net torque on the hinge, A stimulated or at rest (spec 01, Balance)."""
    eA, eB = EPS - R_OVER_L * th, EPS + R_OVER_L * th
    active = (FA * g(eA) - chi * FB * g(eB)) / g(EPS) if stimulated else 0.0
    return R * (active + PA * h(eA) - PB * h(eB)) - kappa * th


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
        """F (n, 2) and P (n, 2): F = eta * sum(a), P = sum(b), eta = exp(u_A + u_C)."""
        sR, sA, sC = PRESETS[preset]
        zA = self.zA_rebuild if rebuilt else self.zA
        F = np.exp(sA * zA + sC * self.zC) * np.exp(np.log(A0) + sR * self.za).sum(axis=2)
        P = (B0 * np.exp(sR * self.zb)).sum(axis=2)
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
    typed = {"eps": EPS, "eps0": EPS0, "w": W, "c": C, "a0": A0, "b0": B0, "r": R,
             "r_over_l": R_OVER_L, "chi_off": CHI_OFF, "chi_on": CHI_ON,
             "kappa_light": KAPPA_LIGHT, "kappa_heavy": KAPPA_HEAVY, "target_deg": TARGET_DEG}
    drift = [k for k, v in typed.items() if not math.isclose(op[k], v, rel_tol=1e-12)]
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
        FA, PA = k * A0, k * B0
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
