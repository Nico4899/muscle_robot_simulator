"""Which source of spread drives the swing (spec 03): variance-based sensitivity.

Pick-freeze with N_BASE base samples: first-order indices by Saltelli et al. (2010), total
indices by Jansen (1999), bootstrap standard errors. Precomputed into oracle.json by
make_oracle.py; the page only draws the bars (no JS port, spec 03).

Groups (spec 03; the ranges are illustrative):
  rings        z_a, z_b of all 8 rings (spread sigma_R of the preset)
  assembly     z_A of both stacks (sigma_A)
  combination  z_C of both stacks (sigma_C)
  crosstalk    chi = chi0 * exp(0.3 z), chi0 the case's unshielded or shielded value
Pre-stretch stays at its default. A group whose spread is 0 in a preset cannot change the
swing, so its indices are exactly 0 and its runs are skipped.
"""
import math

import numpy as np

from model import N_RINGS_MAX, PARAMS, build_stacks, joint_params
from rng import Rng
from statics import swing

GROUPS = ("rings", "assembly", "combination", "crosstalk")
DIMS = {"rings": 4 * N_RINGS_MAX, "assembly": 2, "combination": 2, "crosstalk": 1}
SPREAD_KEY = {"rings": "sigma_R", "assembly": "sigma_A", "combination": "sigma_C"}
CROSSTALK_SIGMA = 0.3  # spec 03: chi0 * exp(0.3 z), illustrative
N_BASE = 2048  # spec 03
N_BOOT = 200  # bootstrap resamples for the standard errors
SEED = 7  # its own stream, separate from the builds' seeds 1-3


def draw(rng, random_groups):
    """One input point: standard normals per group; groups held fixed are 0."""
    x = {}
    for g in GROUPS:
        x[g] = [rng.normal() if g in random_groups else 0.0 for _ in range(DIMS[g])]
    return x


def samples(n, random_groups, seed=SEED):
    """Base matrices A and B: n points each, from one stream (A then B)."""
    rng = Rng(seed)
    a = [draw(rng, random_groups) for _ in range(n)]
    b = [draw(rng, random_groups) for _ in range(n)]
    return a, b


def output(x, preset, load, n_rings, shield):
    """Swing (deg) at one input point; nan when the joint has no balance point (spec 01)."""
    r = x["rings"]
    bz = {
        "A": {"za": r[0:4], "zb": r[4:8], "zA": x["assembly"][0], "zC": x["combination"][0]},
        "B": {"za": r[8:12], "zb": r[12:16], "zA": x["assembly"][1], "zC": x["combination"][1]},
    }
    p = joint_params(load, shield)
    p["chi"] = p["chi"] * math.exp(CROSSTALK_SIGMA * x["crosstalk"][0])
    A, B = build_stacks(bz, n_rings, preset)
    return swing(A, B, p)["swing"]


def active(group, preset):
    """Can this group change the swing in this preset?"""
    if group == "crosstalk":
        return True
    return PARAMS["presets"][preset][SPREAD_KEY[group]] > 0


def first_total(fa, fb, fab):
    """Saltelli (2010) first-order and Jansen (1999) total index; works along the last axis.
    Outputs are centred on their mean first: the indices are the same in expectation, but the
    swing's mean (about 11 deg) is large next to its spread, and uncentred it multiplies the
    first-order estimator's noise (SE about 0.09 instead of about 0.02 at n = 2048)."""
    m = np.mean(np.concatenate([fa, fb], axis=-1), axis=-1, keepdims=True)
    fa, fb, fab = fa - m, fb - m, fab - m
    v = np.var(np.concatenate([fa, fb], axis=-1), axis=-1)
    first = np.mean(fb * (fab - fa), axis=-1) / v
    total = np.mean((fa - fab) ** 2, axis=-1) / (2 * v)
    return first, total


def analyse(preset, load, n_rings, shield, random_groups=GROUPS, n=N_BASE, seed=SEED):
    """First-order and total index of every group, with bootstrap standard errors. If any
    sample has no balance point, the indices are None (undefined) and n_no_balance says how
    many; never a crash (spec 01)."""
    a, b = samples(n, random_groups, seed)
    fa = np.array([output(x, preset, load, n_rings, shield) for x in a])
    fb = np.array([output(x, preset, load, n_rings, shield) for x in b])
    fabs = {}
    for g in GROUPS:
        if g in random_groups and active(g, preset):
            ab = [{**xa, g: xb[g]} for xa, xb in zip(a, b)]  # A with group g taken from B
            fabs[g] = np.array([output(x, preset, load, n_rings, shield) for x in ab])
        else:
            fabs[g] = fa  # the group cannot change the swing: indices exactly 0
    n_bad = int(np.sum(~np.isfinite(fa)) + np.sum(~np.isfinite(fb))
                + sum(np.sum(~np.isfinite(f)) for g, f in fabs.items() if f is not fa))
    keys = ("first", "total", "first_se", "total_se", "diff_se")
    if n_bad:
        return {"n_no_balance": n_bad, "var_deg2": None, **{k: dict.fromkeys(GROUPS) for k in keys}}
    boot = np.random.default_rng(seed).integers(0, n, size=(N_BOOT, n))
    out = {"n_no_balance": 0, "var_deg2": float(np.var(np.concatenate([fa, fb]))),
           **{k: {} for k in keys}}
    for g in GROUPS:
        fab = fabs[g]
        s, t = first_total(fa, fb, fab)
        bs, bt = first_total(fa[boot], fb[boot], fab[boot])
        out["first"][g] = float(s)
        out["total"][g] = float(t)
        out["first_se"][g] = float(np.std(bs))
        out["total_se"][g] = float(np.std(bt))
        out["diff_se"][g] = float(np.std(bs - bt))  # SE of first - total, for spec 03's check
    return out
