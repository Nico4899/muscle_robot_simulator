// Builds of the joint: PARAMS, random stacks, per-case statistics (spec 01).
//
// Port of model.py, line by line with the same names.
// Nothing here is fitted to lab data: every value in PARAMS is a fixed hand choice from spec 01.
//
// Draw order (fixed, spec 01): per build, stack A then stack B; per stack, rings 1..4 (z_a, z_b),
// then z_A, then z_C. Always 4 rings are drawn and the first n_rings used, so changing the ring
// count keeps the same rings. Rebuild draws (one new z_A per stack, A then B) come after all builds,
// so the first n builds of a stream are the same whatever the total drawn.

import { Rng } from "./rng.js";
import { DEG, blocked_torque, curve, swing } from "./statics.js";

export const PARAMS = {
  eps: 0.24, // pre-stretch: upper pre-stretch in Morita et al. 2025
  // strain curves: the published MEAN active and passive force of 4 single rings, Fig. 2D
  // (Dryad file 2D, CC0; claim C20), interpolated between the points, not fitted
  strain: [0.0, 0.0383, 0.152, 0.265, 0.379, 0.492, 0.605, 0.719, 0.832, 0.945, 1.059],
  active: [1.87, 2.15, 2.32, 2.39, 2.4, 2.28, 2.03, 1.82, 1.58, 1.41, 1.07], // mN
  passive: [0.57, 0.91, 1.37, 2.05, 2.9, 3.81, 5.19, 6.32, 7.61, 8.8, 10.34], // mN
  eps_ref: 0.24, // reference strain of the curves: a ring's active force a is given here
  a0: 2.0, // active force of a median ring at eps_ref: about 2 mN per ring, from the paper
  // geometry (spec 01 equations): illustrative
  r: 2.0, // moment arm
  r_over_l: 0.25, // strain per rad of joint angle
  // crosstalk: the paper's field-leakage ratios used as force shares (ASSUMPTION)
  chi_off: 1 / 2.9, // unshielded
  chi_on: 1 / 12, // shielded
  // hinge stiffness (load)
  kappa_light: 2.0, // illustrative
  // hand-chosen once so 4 unshielded rings give about 10 deg; not fitted, never adjust it
  kappa_heavy: 30.0,
  // spread presets (sigma_R rings, sigma_A assembly, sigma_C combination): illustrative
  presets: {
    rings: { sigma_R: 0.25, sigma_A: 0.035, sigma_C: 0.035 },
    assembly: { sigma_R: 0.08, sigma_A: 0.25, sigma_C: 0.0 },
    combination: { sigma_R: 0.08, sigma_A: 0.0, sigma_C: 0.25 },
  },
  target_deg: 8.0, // demo target
  n_builds_page: 50,
  n_builds_oracle: 1500, // the 48-case table (parity and tests)
  // values that reach text or recheck.py: enough builds that seeds agree within 2 % by design
  n_builds_headline: 20000,
};

export const N_RINGS_MAX = 4;
export const LOADS = ["light", "heavy"];
export const SHIELDS = ["unshielded", "shielded"];

// The joint object statics.js expects, for a load and a shielding state. The curves are
// scaled once here: g = active / active(eps_ref); passive in mN of a median ring, scaled so
// that ring gives a0 active force at eps_ref (spec 01).
export function joint_params(load, shield) {
  const active_ref = curve(PARAMS.eps_ref, PARAMS.strain, PARAMS.active);
  const g_curve = [];
  const p_curve = [];
  for (let j = 0; j < PARAMS.strain.length; j++) {
    g_curve.push(PARAMS.active[j] / active_ref);
    p_curve.push((PARAMS.passive[j] * PARAMS.a0) / active_ref);
  }
  return {
    eps: PARAMS.eps,
    chi: shield === "shielded" ? PARAMS.chi_on : PARAMS.chi_off,
    kappa: load === "heavy" ? PARAMS.kappa_heavy : PARAMS.kappa_light,
    r: PARAMS.r,
    r_over_l: PARAMS.r_over_l,
    strain: PARAMS.strain,
    g_curve: g_curve,
    p_curve: p_curve,
  };
}

// Standard-normal draws for one stack, in the fixed order.
export function draw_stack_z(rng) {
  const za = [];
  const zb = [];
  for (let j = 0; j < N_RINGS_MAX; j++) {
    za.push(rng.normal());
    zb.push(rng.normal());
  }
  const zA = rng.normal();
  const zC = rng.normal();
  return { za: za, zb: zb, zA: zA, zC: zC };
}

// n builds, each {A: stack draws, B: stack draws}.
export function draw_builds(rng, n) {
  const builds = [];
  for (let i = 0; i < n; i++) {
    const zs_A = draw_stack_z(rng);
    const zs_B = draw_stack_z(rng);
    builds.push({ A: zs_A, B: zs_B });
  }
  return builds;
}

// One new z_A per stack per build (same rings, same combination), A then B.
export function draw_rebuilds(rng, n) {
  const rebuilds = [];
  for (let i = 0; i < n; i++) {
    const zA_A = rng.normal();
    const zA_B = rng.normal();
    rebuilds.push({ A: zA_A, B: zA_B });
  }
  return rebuilds;
}

// The first n_builds builds of a seed's stream.
export function seed_builds(seed, n_builds) {
  return draw_builds(new Rng(seed), n_builds);
}

// All n_builds_headline builds of a seed's stream, then their rebuild draws.
export function seed_builds_and_rebuilds(seed) {
  const rng = new Rng(seed);
  const n = PARAMS.n_builds_headline;
  const builds = draw_builds(rng, n);
  const rebuilds = draw_rebuilds(rng, n);
  return [builds, rebuilds];
}

// [F, P] of one stack from its draws: first n_rings rings, eta = exp(u_A + u_C);
// P sums the rings' passive factors (1 for a median ring).
export function stack(z, n_rings, preset, zA) {
  const s = PARAMS.presets[preset];
  let sum_a = 0.0;
  let sum_b = 0.0;
  for (let j = 0; j < n_rings; j++) {
    sum_a += Math.exp(Math.log(PARAMS.a0) + s.sigma_R * z.za[j]);
    sum_b += Math.exp(s.sigma_R * z.zb[j]);
  }
  const eta = Math.exp(s.sigma_A * zA + s.sigma_C * z.zC);
  return [eta * sum_a, sum_b];
}

// Both stacks of a build; with rebuild draws rz, the rebuilt joint (new u_A only).
export function build_stacks(bz, n_rings, preset, rz = null) {
  const zA_A = rz === null ? bz.A.zA : rz.A;
  const zA_B = rz === null ? bz.B.zA : rz.B;
  const A = stack(bz.A, n_rings, preset, zA_A);
  const B = stack(bz.B, n_rings, preset, zA_B);
  return [A, B];
}

// Type 7 quantile (linear interpolation between order statistics).
export function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  const hq = (s.length - 1) * q;
  const lo = Math.floor(hq);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (hq - lo) * (s[hi] - s[lo]);
}

// plain loop, as in model.py
export function mean(xs) {
  let total = 0.0;
  for (const x of xs) total += x;
  return total / xs.length;
}

// Population standard deviation (divide by n).
export function sd(xs) {
  const m = mean(xs);
  let total = 0.0;
  for (const x of xs) total += (x - m) * (x - m);
  return Math.sqrt(total / xs.length);
}

// Statistics of the swing over builds for one case (spec 01, oracle.json). A build with no
// balance point in the scan range (NaN: the joint runs to its stop) never crashes: it is
// counted in n_no_balance, left out of the swing statistics, and its raw swing is null.
export function run_case(builds, preset, load, shield, n_rings) {
  const p = joint_params(load, shield);
  const swings = [];
  const rests = [];
  const torques = [];
  const first = [];
  let n_no_balance = 0;
  let n_multi_root = 0;
  let n_hit = 0;
  for (const bz of builds) {
    const [A, B] = build_stacks(bz, n_rings, preset);
    const s = swing(A, B, p);
    torques.push(blocked_torque(A, B, p));
    if (s.n_rest > 1 || s.n_stim > 1) {
      n_multi_root += 1;
    }
    const balanced = !Number.isNaN(s.swing);
    if (first.length < 5) {
      first.push(balanced ? s.swing : null);
    }
    if (!balanced) {
      n_no_balance += 1;
      continue;
    }
    swings.push(s.swing);
    rests.push(s.rest * DEG);
    if (s.swing >= PARAMS.target_deg) {
      n_hit += 1;
    }
  }
  const n = swings.length;
  return {
    median_deg: n > 0 ? quantile(swings, 0.5) : null,
    q10_deg: n > 0 ? quantile(swings, 0.1) : null,
    q90_deg: n > 0 ? quantile(swings, 0.9) : null, // with q10, median: width (I12)
    p_target: n > 0 ? n_hit / n : null,
    rest_sd_deg: n > 0 ? sd(rests) : null,
    blocked_torque: quantile(torques, 0.5),
    n_multi_root: n_multi_root,
    n_no_balance: n_no_balance,
    first_swings_deg: first,
  };
}

// Builds missing the target, and the share of those one rebuild (new u_A) lifts to it,
// with its binomial standard error over the missed builds.
export function rescue_rate(builds, rebuilds, preset, load, shield, n_rings) {
  const p = joint_params(load, shield);
  const target = PARAMS.target_deg;
  let n_missed = 0;
  let n_rescued = 0;
  for (let i = 0; i < builds.length; i++) {
    const [A, B] = build_stacks(builds[i], n_rings, preset);
    if (swing(A, B, p).swing < target) {
      n_missed += 1;
      const [A2, B2] = build_stacks(builds[i], n_rings, preset, rebuilds[i]);
      if (swing(A2, B2, p).swing >= target) {
        n_rescued += 1;
      }
    }
  }
  const rescued = n_missed > 0 ? n_rescued / n_missed : 0.0;
  const se = n_missed > 0 ? Math.sqrt((rescued * (1.0 - rescued)) / n_missed) : 0.0;
  return {
    missed: n_missed / builds.length,
    n_missed: n_missed,
    rescued: rescued,
    rescued_se: se,
  };
}
