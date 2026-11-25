// Exact parity: the JS port recomputes every number in oracle.json from the same seeds (spec 01).
//
// Covered: PARAMS; the probe (draws, stacks, residuals incl. B stimulated, solves); the whole
// table and every headline value for every seed; the multi-root report; the named values.
// The heavy units run in
// worker threads (tests/parity_worker.mjs), all started at load, so they compute in parallel;
// each test awaits its unit and compares here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import { Rng } from "../rng.js";
import { blocked_torque, residual, rest, solve, swing } from "../statics.js";
import { N_RINGS_MAX, PARAMS, build_stacks, joint_params, run_case, seed_builds } from "../model.js";

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

// At most one worker per spare core at a time; the rest wait in order.
const MAX_WORKERS = Math.max(1, availableParallelism() - 1);
let running = 0;
const waiting = [];

// Run one unit in a worker thread; resolves with what the worker posts.
function in_worker(job) {
  const result = new Promise((resolve, reject) => {
    const start = () => {
      running += 1;
      const w = new Worker(new URL("./parity_worker.mjs", import.meta.url), { workerData: job });
      w.once("message", resolve);
      w.once("error", reject);
      w.once("exit", (code) => {
        running -= 1;
        if (waiting.length > 0) waiting.shift()();
        if (code !== 0) reject(new Error(`worker exited with ${code}`));
      });
    };
    if (running < MAX_WORKERS) start();
    else waiting.push(start);
  });
  result.catch(() => {}); // the awaiting test reports it; avoid an unhandled-rejection warning
  return result;
}

// Start every heavy unit now so they run in parallel while the tests await them in order.
const units = {};
for (const seed of oracle.seeds) {
  const s = String(seed);
  units[`table ${s}`] = in_worker({ kind: "table", seed, keys: Object.keys(oracle.table[s]) });
  units[`cases ${s}`] = in_worker({
    kind: "headline_cases",
    seed,
    keys: Object.keys(oracle.headline[s].cases),
  });
  units[`rescue ${s}`] = in_worker({
    kind: "rescue",
    seed,
    keys: Object.keys(oracle.headline[s].rescue),
    rescue_case: oracle.rescue_case,
  });
}
// multi-root report: one worker per (preset, load, shield) group of settings
const report = oracle.multi_root_report;
const groups = {};
for (const c of report.cases) {
  const g = `${c.preset}/${c.load}/${c.shield}`;
  const { any, physical, ...setting } = c;
  (groups[g] ??= []).push(setting);
}
const report_units = Object.entries(groups).map(([g, settings]) => [
  g,
  in_worker({ kind: "multi_root", seed: report.seed, n_builds: report.n_builds, settings }),
]);

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
  const s = String(seed);

  test(`table, seed ${s}: ${PARAMS.n_builds_oracle} builds x every case`, async () => {
    assert_close(await units[`table ${s}`], oracle.table[s], `table.${s}`);
  });

  test(`headline, seed ${s}: ${PARAMS.n_builds_headline} builds, cases and rescue`, async () => {
    const head = oracle.headline[s];
    const cases = await units[`cases ${s}`];
    assert_close(cases, head.cases, `headline.${s}.cases`);
    assert_close(await units[`rescue ${s}`], head.rescue, `headline.${s}.rescue`);

    // per-seed named values, recomputed from the JS cases through the oracle's key map
    const keys = oracle.headline_keys;
    const ratio = cases[keys.shield_on].median_deg / cases[keys.shield_off].median_deg;
    assert_close(ratio, head.shield_ratio, `headline.${s}.shield_ratio`);
    for (const [name, key] of Object.entries(keys)) {
      if (name.startsWith("swing_")) assert_close(cases[key].median_deg, head[name], name);
    }
  });
}

test(`multi-root report: ${report.cases.length} demo settings x ${report.n_builds} builds`, async () => {
  const got = [];
  for (const [, unit] of report_units) got.push(...(await unit));
  const key = (c) => `${c.preset}/${c.load}/${c.shield}/${c.n_rings}/${c.eps}`;
  const by_key = Object.fromEntries(got.map((c) => [key(c), c]));
  const expected = Object.fromEntries(report.cases.map((c) => [key(c), c]));
  assert_close(by_key, expected, "multi_root_report.cases");
  let any = 0;
  let physical = 0;
  for (const c of got) {
    any += c.any;
    physical += c.physical;
  }
  assert_close([any, physical], [report.builds_any, report.builds_physical], "report totals");
});

test("top-level named values are the headline seed's", () => {
  const s = String(oracle.headline_seed);
  const head = oracle.headline[s];
  for (const name of Object.keys(oracle.headline_keys)) {
    if (name.startsWith("swing_")) assert_close(oracle[name], head[name], name);
  }
  assert_close(oracle.shield_ratio, head.shield_ratio, "shield_ratio");
  assert_close(oracle.rescue, head.rescue, "rescue");
  assert_close(oracle.target_deg, PARAMS.target_deg, "target_deg");

  const pc = oracle.page_case;
  const page_builds = seed_builds(oracle.headline_seed, PARAMS.n_builds_page);
  const page = run_case(page_builds, pc.preset, pc.load, pc.shield, pc.n_rings);
  assert_close(page.n_multi_root, oracle.n_multi_root, "n_multi_root");
});
