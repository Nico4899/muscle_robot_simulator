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
