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
import { DEG, blocked_torque, roots, swing } from "./statics.js";

export const PARAMS = {
  // strains
  eps: 0.24, // pre-stretch: upper pre-stretch in Morita et al. 2025
  eps0: 0.26, // active force peak strain: from the paper
  eps_max: 0.37, // strain kept below 37 % in the paper: the physical range is 0 to this
  w: 0.15, // width of the active curve: illustrative
  c: 8.0, // passive stiffening: chosen so passive equals active near 37 % strain
  // forces per ring, mN
  a0: 2.0, // active force at the reference strain: about 2 mN per ring, from the paper
  b0: 0.084, // passive amplitude: illustrative (passive equals active near 37 %)
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

// The joint object statics.js expects, for a load and a shielding state (and optionally a
// pre-stretch other than the default, as the page's slider sets).
export function joint_params(load, shield, eps = null) {
  return {
    eps: eps === null ? PARAMS.eps : eps,
    chi: shield === "shielded" ? PARAMS.chi_on : PARAMS.chi_off,
    kappa: load === "heavy" ? PARAMS.kappa_heavy : PARAMS.kappa_light,
    r: PARAMS.r,
    r_over_l: PARAMS.r_over_l,
    eps0: PARAMS.eps0,
    w: PARAMS.w,
    c: PARAMS.c,
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

// [F, P] of one stack from its draws: first n_rings rings, eta = exp(u_A + u_C).
export function stack(z, n_rings, preset, zA) {
  const s = PARAMS.presets[preset];
  let sum_a = 0.0;
  let sum_b = 0.0;
  for (let j = 0; j < n_rings; j++) {
    sum_a += Math.exp(Math.log(PARAMS.a0) + s.sigma_R * z.za[j]);
    sum_b += PARAMS.b0 * Math.exp(s.sigma_R * z.zb[j]);
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

// Statistics of the swing over builds for one case (spec 01, oracle.json).
export function run_case(builds, preset, load, shield, n_rings) {
  const p = joint_params(load, shield);
  const swings = [];
  const rests = [];
  const torques = [];
  let n_multi_root = 0;
  let n_hit = 0;
  for (const bz of builds) {
    const [A, B] = build_stacks(bz, n_rings, preset);
    const s = swing(A, B, p);
    if (Number.isNaN(s.swing)) {
      throw new Error("no balance point in the scan range");
    }
    swings.push(s.swing);
    rests.push(s.rest * DEG);
    torques.push(blocked_torque(A, B, p));
    if (s.n_rest > 1 || s.n_stim > 1) {
      n_multi_root += 1;
    }
    if (s.swing >= PARAMS.target_deg) {
      n_hit += 1;
    }
  }
  return {
    median_deg: quantile(swings, 0.5),
    q10_deg: quantile(swings, 0.1),
    q90_deg: quantile(swings, 0.9), // with q10 and the median: the relative width (I12)
    p_target: n_hit / builds.length,
    rest_sd_deg: sd(rests),
    blocked_torque: quantile(torques, 0.5),
    n_multi_root: n_multi_root,
    first_swings_deg: swings.slice(0, 5),
  };
}

// Both strains inside 0 to eps_max at joint angle th.
export function physical(th, p) {
  const eA = p.eps - p.r_over_l * th;
  const eB = p.eps + p.r_over_l * th;
  return 0.0 <= eA && eA <= PARAMS.eps_max && 0.0 <= eB && eB <= PARAMS.eps_max;
}

// Builds with more than one balance point at rest or with A stimulated: counting all roots,
// and counting only roots with both strains physical (spec 02 report; not an assertion).
export function count_multi_root(builds, preset, load, shield, n_rings, eps) {
  const p = joint_params(load, shield, eps);
  let n_any = 0;
  let n_physical = 0;
  for (const bz of builds) {
    const [A, B] = build_stacks(bz, n_rings, preset);
    let multi_any = false;
    let multi_physical = false;
    for (const stim of [null, "A"]) {
      const found = roots(A, B, stim, p);
      let n_phys = 0;
      for (const th of found) {
        if (physical(th, p)) n_phys += 1;
      }
      if (found.length > 1) multi_any = true;
      if (n_phys > 1) multi_physical = true;
    }
    if (multi_any) n_any += 1;
    if (multi_physical) n_physical += 1;
  }
  return { any: n_any, physical: n_physical };
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
