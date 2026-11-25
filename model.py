"""Builds of the joint: PARAMS, random stacks, per-case statistics (spec 01).

Reference implementation; model.js ports it line by line with the same names.
Nothing here is fitted to lab data: every value in PARAMS is a fixed hand choice from spec 01.

Draw order (fixed, spec 01): per build, stack A then stack B; per stack, rings 1..4 (z_a, z_b),
then z_A, then z_C. Always 4 rings are drawn and the first n_rings used, so changing the ring
count keeps the same rings. Rebuild draws (one new z_A per stack, A then B) come after all builds,
so the first n builds of a stream are the same whatever the total drawn.
"""
import math

from rng import Rng
from statics import DEG, blocked_torque, curve, swing

PARAMS = {
    "eps": 0.24,  # pre-stretch: upper pre-stretch in Morita et al. 2025
    # strain curves: the published MEAN active and passive force of 4 single rings, Fig. 2D
    # (Dryad file 2D, CC0; claim C20), interpolated between the points, not fitted
    "strain": [0.0, 0.0383, 0.152, 0.265, 0.379, 0.492, 0.605, 0.719, 0.832, 0.945, 1.059],
    "active": [1.87, 2.15, 2.32, 2.39, 2.40, 2.28, 2.03, 1.82, 1.58, 1.41, 1.07],  # mN
    "passive": [0.57, 0.91, 1.37, 2.05, 2.90, 3.81, 5.19, 6.32, 7.61, 8.80, 10.34],  # mN
    "eps_ref": 0.24,  # reference strain of the curves: a ring's active force a is given here
    "a0": 2.0,  # active force of a median ring at eps_ref: about 2 mN per ring, from the paper
    # geometry (spec 01 equations): illustrative
    "r": 2.0,  # moment arm
    "r_over_l": 0.25,  # strain per rad of joint angle
    # crosstalk: the paper's field-leakage ratios used as force shares (ASSUMPTION)
    "chi_off": 1 / 2.9,  # unshielded
    "chi_on": 1 / 12,  # shielded
    # hinge stiffness (load)
    "kappa_light": 2.0,  # illustrative
    # hand-chosen once so 4 unshielded rings give about 10 deg; not fitted, never adjust it
    "kappa_heavy": 30.0,
    # spread presets (sigma_R rings, sigma_A assembly, sigma_C combination): illustrative
    "presets": {
        "rings": {"sigma_R": 0.25, "sigma_A": 0.035, "sigma_C": 0.035},
        "assembly": {"sigma_R": 0.08, "sigma_A": 0.25, "sigma_C": 0.0},
        "combination": {"sigma_R": 0.08, "sigma_A": 0.0, "sigma_C": 0.25},
    },
    "target_deg": 8.0,  # demo target
    "n_builds_page": 50,
    "n_builds_oracle": 1500,  # the 48-case table (parity and tests)
    # values that reach text or recheck.py: enough builds that seeds agree within 2 % by design
    "n_builds_headline": 20000,
}

N_RINGS_MAX = 4
LOADS = ("light", "heavy")
SHIELDS = ("unshielded", "shielded")


def joint_params(load, shield):
    """The joint dict statics.py expects, for a load and a shielding state. The curves are
    scaled once here: g = active / active(eps_ref); passive in mN of a median ring, scaled so
    that ring gives a0 active force at eps_ref (spec 01)."""
    active_ref = curve(PARAMS["eps_ref"], PARAMS["strain"], PARAMS["active"])
    g_curve = []
    p_curve = []
    for j in range(len(PARAMS["strain"])):
        g_curve.append(PARAMS["active"][j] / active_ref)
        p_curve.append(PARAMS["passive"][j] * PARAMS["a0"] / active_ref)
    return {
        "eps": PARAMS["eps"],
        "chi": PARAMS["chi_on"] if shield == "shielded" else PARAMS["chi_off"],
        "kappa": PARAMS["kappa_heavy"] if load == "heavy" else PARAMS["kappa_light"],
        "r": PARAMS["r"],
        "r_over_l": PARAMS["r_over_l"],
        "strain": PARAMS["strain"],
        "g_curve": g_curve,
        "p_curve": p_curve,
    }


def draw_stack_z(rng):
    """Standard-normal draws for one stack, in the fixed order."""
    za = []
    zb = []
    for _ in range(N_RINGS_MAX):
        za.append(rng.normal())
        zb.append(rng.normal())
    zA = rng.normal()
    zC = rng.normal()
    return {"za": za, "zb": zb, "zA": zA, "zC": zC}


def draw_builds(rng, n):
    """n builds, each {"A": stack draws, "B": stack draws}."""
    builds = []
    for _ in range(n):
        zs_A = draw_stack_z(rng)
        zs_B = draw_stack_z(rng)
        builds.append({"A": zs_A, "B": zs_B})
    return builds


def draw_rebuilds(rng, n):
    """One new z_A per stack per build (same rings, same combination), A then B."""
    rebuilds = []
    for _ in range(n):
        zA_A = rng.normal()
        zA_B = rng.normal()
        rebuilds.append({"A": zA_A, "B": zA_B})
    return rebuilds


def seed_builds(seed, n_builds):
    """The first n_builds builds of a seed's stream."""
    return draw_builds(Rng(seed), n_builds)


def seed_builds_and_rebuilds(seed):
    """All n_builds_headline builds of a seed's stream, then their rebuild draws."""
    rng = Rng(seed)
    n = PARAMS["n_builds_headline"]
    builds = draw_builds(rng, n)
    rebuilds = draw_rebuilds(rng, n)
    return builds, rebuilds


def stack(z, n_rings, preset, zA):
    """(F, P) of one stack from its draws: first n_rings rings, eta = exp(u_A + u_C);
    P sums the rings' passive factors (1 for a median ring)."""
    s = PARAMS["presets"][preset]
    sum_a = 0.0
    sum_b = 0.0
    for j in range(n_rings):
        sum_a += math.exp(math.log(PARAMS["a0"]) + s["sigma_R"] * z["za"][j])
        sum_b += math.exp(s["sigma_R"] * z["zb"][j])
    eta = math.exp(s["sigma_A"] * zA + s["sigma_C"] * z["zC"])
    return (eta * sum_a, sum_b)


def build_stacks(bz, n_rings, preset, rz=None):
    """Both stacks of a build; with rebuild draws rz, the rebuilt joint (new u_A only)."""
    zA_A = bz["A"]["zA"] if rz is None else rz["A"]
    zA_B = bz["B"]["zA"] if rz is None else rz["B"]
    A = stack(bz["A"], n_rings, preset, zA_A)
    B = stack(bz["B"], n_rings, preset, zA_B)
    return A, B


def quantile(xs, q):
    """Type 7 quantile (linear interpolation between order statistics)."""
    s = sorted(xs)
    hq = (len(s) - 1) * q
    lo = math.floor(hq)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (hq - lo) * (s[hi] - s[lo])


def mean(xs):
    # plain loop: Python's sum() compensates float rounding since 3.12, JS does not
    total = 0.0
    for x in xs:
        total += x
    return total / len(xs)


def sd(xs):
    """Population standard deviation (divide by n)."""
    m = mean(xs)
    total = 0.0
    for x in xs:
        total += (x - m) * (x - m)
    return math.sqrt(total / len(xs))


def run_case(builds, preset, load, shield, n_rings):
    """Statistics of the swing over builds for one case (spec 01, oracle.json). A build with no
    balance point in the scan range (NaN: the joint runs to its stop) never crashes: it is
    counted in n_no_balance, left out of the swing statistics, and its raw swing is None."""
    p = joint_params(load, shield)
    swings = []
    rests = []
    torques = []
    first = []
    n_no_balance = 0
    n_multi_root = 0
    n_hit = 0
    for bz in builds:
        A, B = build_stacks(bz, n_rings, preset)
        s = swing(A, B, p)
        torques.append(blocked_torque(A, B, p))
        if s["n_rest"] > 1 or s["n_stim"] > 1:
            n_multi_root += 1
        balanced = not math.isnan(s["swing"])
        if len(first) < 5:
            first.append(s["swing"] if balanced else None)
        if not balanced:
            n_no_balance += 1
            continue
        swings.append(s["swing"])
        rests.append(s["rest"] * DEG)
        if s["swing"] >= PARAMS["target_deg"]:
            n_hit += 1
    n = len(swings)
    return {
        "median_deg": quantile(swings, 0.5) if n > 0 else None,
        "q10_deg": quantile(swings, 0.1) if n > 0 else None,
        "q90_deg": quantile(swings, 0.9) if n > 0 else None,  # with q10, median: width (I12)
        "p_target": n_hit / n if n > 0 else None,
        "rest_sd_deg": sd(rests) if n > 0 else None,
        "blocked_torque": quantile(torques, 0.5),
        "n_multi_root": n_multi_root,
        "n_no_balance": n_no_balance,
        "first_swings_deg": first,
    }


def rescue_rate(builds, rebuilds, preset, load, shield, n_rings):
    """Builds missing the target, and the share of those one rebuild (new u_A) lifts to it,
    with its binomial standard error over the missed builds."""
    p = joint_params(load, shield)
    target = PARAMS["target_deg"]
    n_missed = 0
    n_rescued = 0
    for i in range(len(builds)):
        A, B = build_stacks(builds[i], n_rings, preset)
        if swing(A, B, p)["swing"] < target:
            n_missed += 1
            A2, B2 = build_stacks(builds[i], n_rings, preset, rebuilds[i])
            if swing(A2, B2, p)["swing"] >= target:
                n_rescued += 1
    rescued = n_rescued / n_missed if n_missed > 0 else 0.0
    se = math.sqrt(rescued * (1.0 - rescued) / n_missed) if n_missed > 0 else 0.0
    return {
        "missed": n_missed / len(builds),
        "n_missed": n_missed,
        "rescued": rescued,
        "rescued_se": se,
    }
