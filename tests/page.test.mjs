// The page's logic (page/app.js, spec 03), without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PRESETS,
  apply,
  compute_view,
  cue_state,
  default_state,
  parity_check,
  render,
} from "../page/app.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const oracle = read("../oracle.json");
const captions = read("../captions.json");
const cues = read("../page/cues.json");
const BUDGET_MS = 100; // spec 03: every update under 100 ms

test("default state is the oracle's page case, at rest", () => {
  const s = default_state(oracle);
  const pc = oracle.page_case;
  assert.deepEqual([s.preset, s.load, s.shield, s.n_rings], [pc.preset, pc.load, pc.shield, pc.n_rings]);
  assert.equal(s.stim, null);
  assert.equal(s.fixed, false);
});

test("the page's first build swings as the oracle's table says", () => {
  const view = compute_view(default_state(oracle));
  const pc = oracle.page_case;
  const key = `${pc.preset}/${pc.load}/${pc.n_rings}/${pc.shield}`;
  const expected = oracle.table[String(oracle.headline_seed)][key].first_swings_deg;
  view.rows.slice(0, expected.length).forEach((r, i) => {
    assert.ok(Math.abs(r.swing - expected[i]) <= 1e-9 * Math.abs(expected[i]), `build ${i}`);
  });
});

test("parity badge: green on the real oracle, red on a changed one", () => {
  const ok = parity_check(oracle);
  assert.equal(ok.ok, true, ok.fails.join(", "));
  assert.ok(ok.checked > 0);
  const bad = structuredClone(oracle);
  const table = bad.table[String(bad.headline_seed)];
  const key = Object.keys(table)[0];
  table[key].first_swings_deg[0] *= 1 + 1e-6;
  assert.equal(parity_check(bad).ok, false);
  const bad_params = structuredClone(oracle);
  bad_params.params.kappa_heavy += 1;
  assert.equal(parity_check(bad_params).ok, false);
});

test("every caption a control can show exists and renders without placeholders or tags", () => {
  const actions = ["stimulate", "fixed", "rings:2", "rings+", "rings-", "spread", "rebuild", "shield", "load", "new", "reset"];
  let s = default_state(oracle);
  const seen = new Set([s.caption]);
  for (let round = 0; round < PRESETS.length; round++) {
    for (const a of actions) {
      s = apply(s, a, oracle);
      seen.add(s.caption);
    }
  }
  for (const key of seen) {
    assert.ok(captions.steps[key], `captions.json has no steps.${key}`);
    const text = render(captions.steps[key], oracle);
    assert.ok(!/\{\{|\[[A-Z]\d+\]/.test(text), `${key}: ${text}`);
  }
});

test("captions follow the last change", () => {
  let s = default_state(oracle);
  s = apply(s, "shield", oracle);
  assert.equal(s.caption, "shield");
  s = apply(s, "load", oracle);
  assert.equal(s.caption, "rings_light");
  s = apply(s, "spread", oracle);
  assert.equal(s.caption, "spread");
  s = apply(s, "rebuild", oracle);
  assert.equal(s.caption, `rebuild_${s.preset}`);
});

test("clip cues: stimulate and release at the marked times, alternating sides", () => {
  assert.equal(cue_state(cues, 0), null);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    assert.equal(cue_state(cues, c.t), c.on ? c.side : null, `at ${c.t} s`);
    const next = i + 1 < cues.length ? cues[i + 1].t : c.t + 1;
    assert.equal(cue_state(cues, (c.t + next) / 2), c.on ? c.side : null);
  }
});

test("fixed force: all builds swing the same", () => {
  let s = apply(default_state(oracle), "fixed", oracle);
  s = apply(s, "stimulate", oracle);
  const swings = compute_view(s).rows.map((r) => r.swing);
  assert.equal(new Set(swings).size, 1);
});

test("rebuild: no assembly spread, no change; assembly spread, a change", () => {
  let s = default_state(oracle);
  while (s.preset !== "combination") s = apply(s, "spread", oracle);
  const before = compute_view(s).rows[0].swing;
  assert.equal(compute_view(apply(s, "rebuild", oracle)).rows[0].swing, before);
  while (s.preset !== "assembly") s = apply(s, "spread", oracle);
  const before_a = compute_view(s).rows[0].swing;
  assert.notEqual(compute_view(apply(s, "rebuild", oracle)).rows[0].swing, before_a);
});

test("side B mirrors: the swing toward the stimulated side is positive", () => {
  let s = apply(default_state(oracle), "stimulate", oracle); // A
  s = apply(s, "stimulate", oracle); // release, next side B
  s = apply(s, "stimulate", oracle); // B
  assert.equal(s.stim, "B");
  const v = compute_view(s);
  assert.ok(v.stats.median > 0);
  assert.ok(v.rows.every((r) => r.shown < r.rest || !r.balanced));
});

test(`every update stays under ${BUDGET_MS} ms`, () => {
  let worst = 0;
  for (const preset of PRESETS) {
    for (const load of ["light", "heavy"]) {
      for (const shield of ["unshielded", "shielded"]) {
        for (let n = 1; n <= 4; n++) {
          for (const fixed of [false, true]) {
            for (const stim of [null, "A", "B"]) {
              const s = { ...default_state(oracle), preset, load, shield, n_rings: n, fixed, stim };
              // fastest of three: make check runs this beside the parity workers, and one run
              // can stall on a busy CPU; the page's own cost is the fastest run
              let best = Infinity;
              for (let k = 0; k < 3; k++) {
                const t0 = performance.now();
                compute_view(s);
                best = Math.min(best, performance.now() - t0);
              }
              worst = Math.max(worst, best);
            }
          }
        }
      }
    }
  }
  assert.ok(worst < BUDGET_MS, `slowest update ${worst.toFixed(1)} ms`);
});
