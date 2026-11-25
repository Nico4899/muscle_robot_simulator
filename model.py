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
from statics import DEG, blocked_torque, swing

PARAMS = {
    # strains
    "eps": 0.24,  # pre-stretch: upper pre-stretch in Morita et al. 2025
    "eps0": 0.26,  # active force peak strain: from the paper
    "w": 0.15,  # width of the active curve: illustrative
    "c": 8.0,  # passive stiffening: chosen so passive equals active near 37 % strain
    # forces per ring, mN
    "a0": 2.0,  # active force at the reference strain: about 2 mN per ring, from the paper
    "b0": 0.084,  # passive amplitude: illustrative (passive equals active near 37 %)
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
    """The joint dict statics.py expects, for a load and a shielding state."""
    return {
        "eps": PARAMS["eps"],
        "chi": PARAMS["chi_on"] if shield == "shielded" else PARAMS["chi_off"],
        "kappa": PARAMS["kappa_heavy"] if load == "heavy" else PARAMS["kappa_light"],
        "r": PARAMS["r"],
        "r_over_l": PARAMS["r_over_l"],
        "eps0": PARAMS["eps0"],
        "w": PARAMS["w"],
        "c": PARAMS["c"],
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
    """(F, P) of one stack from its draws: first n_rings rings, eta = exp(u_A + u_C)."""
    s = PARAMS["presets"][preset]
    sum_a = 0.0
    sum_b = 0.0
    for j in range(n_rings):
        sum_a += math.exp(math.log(PARAMS["a0"]) + s["sigma_R"] * z["za"][j])
        sum_b += PARAMS["b0"] * math.exp(s["sigma_R"] * z["zb"][j])
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
    """Statistics of the swing over builds for one case (spec 01, oracle.json)."""
    p = joint_params(load, shield)
    swings = []
    rests = []
    torques = []
    n_multi_root = 0
    n_hit = 0
    for bz in builds:
        A, B = build_stacks(bz, n_rings, preset)
        s = swing(A, B, p)
        if math.isnan(s["swing"]):
            raise ValueError("no balance point in the scan range")
        swings.append(s["swing"])
        rests.append(s["rest"] * DEG)
        torques.append(blocked_torque(A, B, p))
        if s["n_rest"] > 1 or s["n_stim"] > 1:
            n_multi_root += 1
        if s["swing"] >= PARAMS["target_deg"]:
            n_hit += 1
    return {
        "median_deg": quantile(swings, 0.5),
        "q10_deg": quantile(swings, 0.1),
        "p_target": n_hit / len(builds),
        "rest_sd_deg": sd(rests),
        "blocked_torque": quantile(torques, 0.5),
        "n_multi_root": n_multi_root,
        "first_swings_deg": swings[:5],
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
