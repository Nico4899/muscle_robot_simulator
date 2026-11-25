"""Write oracle.json: every number the page, captions and tests use (spec 01).

Seeds 1, 2, 3, one draw stream per seed: n_builds_headline builds, then their rebuild draws.
- Table: first n_builds_oracle builds, per preset x load x rings 1..4 x shielding. Used by parity
  and tests; its seed spreads are reported, not asserted (sampling noise at this n).
- Headline values (shield_ratio, rescue rates, caption medians): all n_builds_headline builds.
  These reach text or recheck.py; the three seeds must agree (spec 01, Checks).
Headline values are taken from seed 1. Exits 1 if a seed check fails (oracle.json still written).
The sensitivity table (spec 03) is added in build step 6.
"""
import json
import math
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor

from model import (LOADS, N_RINGS_MAX, PARAMS, SHIELDS, build_stacks, joint_params, rescue_rate,
                   run_case, seed_builds, seed_builds_and_rebuilds)
from rng import Rng
from statics import blocked_torque, residual, rest, solve, swing

SEEDS = (1, 2, 3)
HEADLINE_SEED = 1
SEED_AGREEMENT = 0.02  # spec 01: headline ratios and medians agree within 2 %
RATE_FLOOR = 0.03  # spec 01/04: rates within max(0.03, 3 x combined SE)
RATE_N_SE = 3.0
# shield_ratio and rescue rates: 4 rings, heavy; shield_ratio on the rings preset (spec 01)
SHIELD_CASES = {"shielded": ("rings", "heavy", 4, "shielded"),
                "unshielded": ("rings", "heavy", 4, "unshielded")}
RESCUE_CASE = ("heavy", "unshielded", 4)
# caption medians: rings preset, unshielded (spec leaves the preset open; ASSUMPTION)
CAPTION_CASES = {f"swing_{load}_n{n}": ("rings", load, n, "unshielded")
                 for load in ("heavy", "light") for n in (1, 4)}
# page default (spec 03 leaves it open; ASSUMPTION): rings preset, heavy, 4 rings, unshielded
PAGE_CASE = ("rings", "heavy", 4, "unshielded")


def case_key(preset, load, n_rings, shield):
    return f"{preset}/{load}/{n_rings}/{shield}"


def probe():
    """Layer-by-layer values (draws, stacks, residuals, solves) for diagnosing a parity failure.
    Also the only place the B-stimulated branch is exercised in the oracle."""
    rng = Rng(1)
    uniforms = [rng.uniform() for _ in range(8)]
    rng = Rng(1)
    normals = [rng.normal() for _ in range(8)]
    b0 = seed_builds(1, 1)[0]
    stacks = {preset: [list(build_stacks(b0, n, preset)) for n in range(1, N_RINGS_MAX + 1)]
              for preset in PARAMS["presets"]}
    p = joint_params("heavy", "unshielded")
    A, B = build_stacks(b0, 4, "rings")
    angles = [-1.0, -0.3, 0.0, 0.3, 1.0]
    residuals = {str(stim): [residual(th, A, B, stim, p) for th in angles]
                 for stim in (None, "A", "B")}
    th_rest, n_rest = rest(A, B, p)
    th_b, n_b = solve(A, B, "B", p, th_rest)
    return {
        "uniforms_seed1": uniforms,
        "normals_seed1": normals,
        "build0_stacks": stacks,
        "joint": {"preset": "rings", "load": "heavy", "shield": "unshielded", "n_rings": 4},
        "angles": angles,
        "residuals": residuals,
        "rest": [th_rest, n_rest],
        "stim_B": [th_b, n_b],
        "swing": swing(A, B, p),
        "blocked_torque": blocked_torque(A, B, p),
    }


def run_job(job):
    """One unit of work: ("table", seed, preset), ("case", seed, case) or ("rescue", seed, preset)."""
    kind, seed, arg = job
    if kind == "table":
        builds = seed_builds(seed, PARAMS["n_builds_oracle"])
        out = {}
        for load in LOADS:
            for n_rings in range(1, N_RINGS_MAX + 1):
                for shield in SHIELDS:
                    out[case_key(arg, load, n_rings, shield)] = run_case(
                        builds, arg, load, shield, n_rings)
        return job, out
    if kind == "case":
        preset, load, n_rings, shield = arg
        builds = seed_builds(seed, PARAMS["n_builds_headline"])
        return job, run_case(builds, preset, load, shield, n_rings)
    builds, rebuilds = seed_builds_and_rebuilds(seed)
    load, shield, n_rings = RESCUE_CASE
    return job, rescue_rate(builds, rebuilds, arg, load, shield, n_rings)


def caption_strings(node):
    """All caption strings, skipping "_"-prefixed notes (the _note mentions {{key}} itself)."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            if not k.startswith("_"):
                yield from caption_strings(v)


def caption_keys():
    """Every {{key}} or {{key:fmt}} placeholder in captions.json."""
    with open("captions.json", encoding="utf-8") as fh:
        captions = json.load(fh)
    keys = set()
    for text in caption_strings(captions):
        keys.update(re.findall(r"\{\{(\w+)(?::[^}]*)?\}\}", text))
    return sorted(keys)


def rel_spread(values):
    """(max - min) / mid."""
    lo, hi = min(values), max(values)
    mid = (lo + hi) / 2
    return (hi - lo) / abs(mid) if mid != 0 else (0.0 if hi == lo else math.inf)


def run_all():
    """Table and headline values for every seed, in parallel."""
    headline_cases = sorted(set(SHIELD_CASES.values()) | set(CAPTION_CASES.values()))
    jobs = ([("table", s, p) for s in SEEDS for p in PARAMS["presets"]]
            + [("case", s, c) for s in SEEDS for c in headline_cases]
            + [("rescue", s, p) for s in SEEDS for p in PARAMS["presets"]])
    table = {s: {} for s in SEEDS}
    headline = {s: {"cases": {}, "rescue": {}} for s in SEEDS}
    with ProcessPoolExecutor() as pool:
        for (kind, seed, arg), out in pool.map(run_job, jobs):
            if kind == "table":
                table[seed].update(out)
            elif kind == "case":
                headline[seed]["cases"][case_key(*arg)] = out
            else:
                headline[seed]["rescue"][arg] = out
    for s in SEEDS:
        cases = headline[s]["cases"]
        on = cases[case_key(*SHIELD_CASES["shielded"])]["median_deg"]
        off = cases[case_key(*SHIELD_CASES["unshielded"])]["median_deg"]
        headline[s]["shield_ratio"] = on / off
        for name, case in CAPTION_CASES.items():
            headline[s][name] = cases[case_key(*case)]["median_deg"]
    return table, headline


def seed_checks(headline):
    """One (ok, line) per headline value: do the three seeds agree (spec 01, Checks)?"""
    results = []
    for name in ["shield_ratio", *CAPTION_CASES]:
        vals = [headline[s][name] for s in SEEDS]
        spread = rel_spread(vals)
        ok = spread <= SEED_AGREEMENT
        results.append((ok, f"{name:19s}" + "  ".join(f"{v:7.3f}" for v in vals)
                        + f"   spread {spread:5.2%} <= {SEED_AGREEMENT:.0%}"))
    for preset in PARAMS["presets"]:
        rs = [headline[s]["rescue"][preset] for s in SEEDS]
        worst_diff, worst_tol = 0.0, RATE_FLOOR
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                diff = abs(rs[i]["rescued"] - rs[j]["rescued"])
                tol = max(RATE_FLOOR, RATE_N_SE * math.hypot(rs[i]["rescued_se"],
                                                              rs[j]["rescued_se"]))
                if diff / tol > worst_diff / worst_tol:
                    worst_diff, worst_tol = diff, tol
        ok = worst_diff <= worst_tol
        results.append((ok, f"rescue {preset:12s}"
                        + "  ".join(f"{r['rescued']:.3f}±{r['rescued_se']:.3f}" for r in rs)
                        + f"   worst pair {worst_diff:.3f} <= {worst_tol:.3f}"))
    return results


def main():
    t0 = time.time()
    table, headline = run_all()
    head = headline[HEADLINE_SEED]
    page_builds = seed_builds(HEADLINE_SEED, PARAMS["n_builds_page"])
    preset, load, n_rings, shield = PAGE_CASE

    named = {
        "target_deg": PARAMS["target_deg"],
        "shield_ratio": head["shield_ratio"],
        **{name: head[name] for name in CAPTION_CASES},
        "n_multi_root": run_case(page_builds, preset, load, shield, n_rings)["n_multi_root"],
    }
    missing = [k for k in caption_keys() if k not in named]
    if missing:
        sys.exit(f"captions.json needs keys make_oracle.py does not produce: {missing}")

    oracle = {
        "_note": "Generated by make_oracle.py; do not edit. Illustrative model, not fitted.",
        "params": PARAMS,
        "seeds": list(SEEDS),
        "headline_seed": HEADLINE_SEED,
        "rescue_case": dict(zip(("load", "shield", "n_rings"), RESCUE_CASE)),
        "page_case": dict(zip(("preset", "load", "n_rings", "shield"), PAGE_CASE)),
        # which headline case each named value comes from (parity and tests read these)
        "headline_keys": {"shield_on": case_key(*SHIELD_CASES["shielded"]),
                          "shield_off": case_key(*SHIELD_CASES["unshielded"]),
                          **{name: case_key(*c) for name, c in CAPTION_CASES.items()}},
        "probe": probe(),
        **named,
        "rescue": head["rescue"],
        "headline": {str(s): headline[s] for s in SEEDS},
        "table": {str(s): table[s] for s in SEEDS},
    }
    with open("oracle.json", "w", encoding="utf-8") as fh:
        json.dump(oracle, fh, indent=1)
        fh.write("\n")

    n_cases = len(table[HEADLINE_SEED])
    print(f"oracle.json: table {len(SEEDS)} seeds x {n_cases} cases x "
          f"{PARAMS['n_builds_oracle']} builds; headline values x "
          f"{PARAMS['n_builds_headline']} builds ({time.time() - t0:.1f} s)")
    checks = seed_checks(headline)
    print("seed checks (seeds 1 2 3):")
    for ok, line in checks:
        print(f"  {'ok  ' if ok else 'FAIL'} {line}")
    print("  spec expects shield_ratio about 1.35, rescue about 0.25 / 0.78 / 0.00")
    print("table seed spread (reported, not asserted):")
    for name in ("median_deg", "q10_deg", "p_target", "rest_sd_deg", "blocked_torque"):
        spreads = {k: rel_spread([table[s][k][name] for s in SEEDS]) for k in table[HEADLINE_SEED]}
        worst = max(spreads, key=spreads.get)
        print(f"  {name:15s} max {spreads[worst]:6.1%} ({worst})")
    n_multi = sum(c["n_multi_root"] for s in SEEDS for c in table[s].values())
    n_multi += sum(c["n_multi_root"] for s in SEEDS for c in headline[s]["cases"].values())
    print(f"builds with more than one root, table and headline, all seeds: {n_multi}")
    print("caption values (seed 1): " + ", ".join(
        f"{k} {v:.3g}" if isinstance(v, float) else f"{k} {v}" for k, v in named.items()))
    if not all(ok for ok, _ in checks):
        sys.exit("seed check failed: report it; do not change seeds or tolerances")


if __name__ == "__main__":
    main()
