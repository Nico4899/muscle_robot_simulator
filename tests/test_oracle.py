"""Checks on oracle.json itself (spec 01 and 02): claims the page shows, in every state it can
show them, read from the precomputed table. The table comes from the reference (make oracle)
and parity ties it to the port, so these need no recomputation and cost almost nothing.
Not run by mutmut: a mutant of the reference never reaches oracle.json.
"""
import json
import pathlib

import pytest

ORACLE = json.loads((pathlib.Path(__file__).resolve().parent.parent / "oracle.json")
                    .read_text(encoding="utf-8"))
STATES = [(load, shield) for load in ("heavy", "light") for shield in ("unshielded", "shielded")]


def relative_width(case):
    """(q90 - q10) / median, as in test_physics.py and the reference scripts."""
    return (case["q90_deg"] - case["q10_deg"]) / case["median_deg"]


@pytest.mark.parametrize("seed", [str(s) for s in ORACLE["seeds"]])
@pytest.mark.parametrize("load,shield", STATES)
def test_I12_all_page_states_more_rings_narrower_spread(load, shield, seed):
    """Model claim, in every load x shielding state of the page: rings preset, relative width at
    N = 4 below N = 1 (1500 builds per seed)."""
    table = ORACLE["table"][seed]
    w1 = relative_width(table[f"rings/{load}/1/{shield}"])
    w4 = relative_width(table[f"rings/{load}/4/{shield}"])
    assert w4 < w1, f"{load}, {shield}, seed {seed}: width N=4 {w4:.3f} not below N=1 {w1:.3f}"


SENS = ORACLE["sensitivity"]
SHARE_MIN = 0.95  # spec 03: one group random -> its total share >= 0.95


@pytest.mark.parametrize("group", ["rings", "crosstalk"])
def test_sensitivity_control_one_group_random_takes_the_variance(group):
    """Spec 03: with only this group random (page case), its total share is >= 0.95 and every
    other group's is 0."""
    c = SENS["controls"][group]
    assert c["total"][group] >= SHARE_MIN, c["total"]
    for g in SENS["groups"]:
        if g != group:
            assert c["total"][g] == 0.0 and c["first"][g] == 0.0


def test_sensitivity_every_sample_balances():
    """Indices are defined only when every pick-freeze sample has a balance point."""
    assert all(c["n_no_balance"] == 0 for c in SENS["cases"].values())
    assert all(c["n_no_balance"] == 0 for c in SENS["controls"].values())


@pytest.mark.parametrize("key", sorted(SENS["cases"]))
def test_sensitivity_total_not_below_first_order(key):
    """Spec 03: total >= first-order - 3 SE (SE of the difference, bootstrap), every group."""
    c = SENS["cases"][key]
    for g in SENS["groups"]:
        assert c["total"][g] >= c["first"][g] - 3 * c["diff_se"][g], (g, c["first"][g], c["total"][g])


@pytest.mark.parametrize("key", sorted(SENS["cases"]))
def test_sensitivity_groups_without_spread_get_nothing(key):
    """A group whose spread is 0 in the preset cannot drive the swing: both indices exactly 0."""
    preset = key.split("/")[0]
    spread = {"rings": "sigma_R", "assembly": "sigma_A", "combination": "sigma_C"}
    for g, k in spread.items():
        if ORACLE["params"]["presets"][preset][k] == 0:
            assert SENS["cases"][key]["total"][g] == 0.0
            assert SENS["cases"][key]["first"][g] == 0.0
