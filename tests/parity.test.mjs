// Exact parity: the JS port recomputes oracle.json's numbers from the same seeds (spec 01).
//
// Covered: PARAMS; the probe (draws, stacks, residuals incl. B stimulated, solves); the whole
// table for every seed; every headline value of the headline seed (the numbers that reach text).
// Not recomputed: headline values of the other seeds (they only feed make_oracle.py's seed check
// and run the same code paths; recomputing them would take about 6 s of the make check budget).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Rng } from "../rng.js";
import { blocked_torque, residual, rest, solve, swing } from "../statics.js";
import {
  N_RINGS_MAX,
  PARAMS,
  build_stacks,
  joint_params,
  rescue_rate,
  run_case,
  seed_builds,
  seed_builds_and_rebuilds,
} from "../model.js";

const oracle = JSON.parse(readFileSync(new URL("../oracle.json", import.meta.url), "utf8"));
const REL = 1e-9; // spec 01 parity tolerance, relative

// Numbers within REL, everything else equal; the message names the first path that differs.
function assert_close(actual, expected, path) {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", `${path}: JS gave ${actual}`);
    const tol = REL * Math.max(Math.abs(actual), Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= tol, `${path}: JS ${actual} vs Python ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: JS gave ${actual}`);
    assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((e, i) => assert_close(actual[i], e, `${path}[${i}]`));
  } else if (expected !== null && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: keys`);
    for (const k of Object.keys(expected)) assert_close(actual[k], expected[k], `${path}.${k}`);
  } else {
    assert.equal(actual, expected, path);
  }
}

// "rings/heavy/4/unshielded" -> run_case arguments
function parse_key(key) {
  const [preset, load, n_rings, shield] = key.split("/");
  return { preset, load, shield, n_rings: Number(n_rings) };
}

function case_from_key(builds, key) {
  const c = parse_key(key);
  return run_case(builds, c.preset, c.load, c.shield, c.n_rings);
}

test("PARAMS are the oracle's PARAMS", () => {
  assert.deepEqual(PARAMS, oracle.params);
});

test("probe: draws, stacks, residuals, solves", () => {
  const probe = oracle.probe;
  const rng_u = new Rng(1);
  const uniforms = probe.uniforms_seed1.map(() => rng_u.uniform());
  assert.deepEqual(uniforms, probe.uniforms_seed1); // integer steps: bit-exact
  const rng_n = new Rng(1);
  assert_close(probe.normals_seed1.map(() => rng_n.normal()), probe.normals_seed1, "normals");

  const b0 = seed_builds(1, 1)[0];
  const stacks = {};
  for (const preset of Object.keys(PARAMS.presets)) {
    stacks[preset] = [];
    for (let n = 1; n <= N_RINGS_MAX; n++) stacks[preset].push(build_stacks(b0, n, preset));
  }
  assert_close(stacks, probe.build0_stacks, "build0_stacks");

  const j = probe.joint;
  const p = joint_params(j.load, j.shield);
  const [A, B] = build_stacks(b0, j.n_rings, j.preset);
  const stims = { None: null, A: "A", B: "B" };
  for (const [name, stim] of Object.entries(stims)) {
    const got = probe.angles.map((th) => residual(th, A, B, stim, p));
    assert_close(got, probe.residuals[name], `residuals.${name}`);
  }
  const r = rest(A, B, p);
  assert_close(r, probe.rest, "rest");
  assert_close(solve(A, B, "B", p, r[0]), probe.stim_B, "stim_B");
  assert_close(swing(A, B, p), probe.swing, "swing");
  assert_close(blocked_torque(A, B, p), probe.blocked_torque, "blocked_torque");
});

for (const seed of oracle.seeds) {
  test(`table, seed ${seed}: ${PARAMS.n_builds_oracle} builds x every case`, () => {
    const builds = seed_builds(seed, PARAMS.n_builds_oracle);
    for (const [key, expected] of Object.entries(oracle.table[String(seed)])) {
      assert_close(case_from_key(builds, key), expected, `table.${seed}.${key}`);
    }
  });
}

test(`headline values, seed ${oracle.headline_seed}: ${PARAMS.n_builds_headline} builds`, () => {
  const seed = oracle.headline_seed;
  const head = oracle.headline[String(seed)];
  const [builds, rebuilds] = seed_builds_and_rebuilds(seed);

  const cases = {};
  for (const key of Object.keys(head.cases)) cases[key] = case_from_key(builds, key);
  assert_close(cases, head.cases, `headline.${seed}.cases`);

  const rc = oracle.rescue_case;
  for (const [preset, expected] of Object.entries(head.rescue)) {
    const got = rescue_rate(builds, rebuilds, preset, rc.load, rc.shield, rc.n_rings);
    assert_close(got, expected, `headline.${seed}.rescue.${preset}`);
  }
  assert_close(oracle.rescue, head.rescue, "rescue (top level is the headline seed)");

  // named values, recomputed from the JS cases through the oracle's own key map
  const keys = oracle.headline_keys;
  const ratio = cases[keys.shield_on].median_deg / cases[keys.shield_off].median_deg;
  assert_close(ratio, oracle.shield_ratio, "shield_ratio");
  for (const [name, key] of Object.entries(keys)) {
    if (name.startsWith("swing_")) assert_close(cases[key].median_deg, oracle[name], name);
  }
  const pc = oracle.page_case;
  const page_builds = seed_builds(seed, PARAMS.n_builds_page);
  const page = run_case(page_builds, pc.preset, pc.load, pc.shield, pc.n_rings);
  assert_close(page.n_multi_root, oracle.n_multi_root, "n_multi_root");
  assert_close(oracle.target_deg, PARAMS.target_deg, "target_deg");
});
