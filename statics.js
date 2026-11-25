// Joint statics: two muscle stacks on a hinge (spec 01, proposal Eq. 2 to 4).
//
// Port of statics.py, line by line with the same names.
// A stack is a pair [F, P]: F active force at the reference strain (mN), P passive amplitude (mN).
// `p` is a joint object from model.joint_params: eps, chi, kappa, r, r_over_l, eps0, w, c.
// Squares are written as d * d and sums as plain loops so both languages round the same way.

export const TH_MAX = 1.2; // rad, scan range [-TH_MAX, TH_MAX] (spec 01)
export const N_SCAN = 241; // scan points (spec 01)
export const N_HALVINGS = 60; // bisection halvings (spec 01)
export const DEG = 180.0 / Math.PI; // rad -> deg

// TH_MAX * (k - m) / m: symmetric, point N_SCAN - 1 - k is exactly minus point k.
export function scan_grid() {
  const m = Math.floor((N_SCAN - 1) / 2);
  const grid = [];
  for (let k = 0; k < N_SCAN; k++) grid.push((TH_MAX * (k - m)) / m);
  return grid;
}

export const GRID = scan_grid();

// Active force-length curve: Gaussian, 1 at the peak strain eps0, width w.
export function g(e, p) {
  const d = e - p.eps0;
  return Math.exp(-(d * d) / (2.0 * p.w * p.w));
}

// Passive force-length curve: exp(c e) - 1.
export function h(e, p) {
  return Math.exp(p.c * e) - 1.0;
}

// Net torque at joint angle th (rad); zero at balance. stim is "A", "B" or null (rest).
export function residual(th, A, B, stim, p) {
  const [F_A, P_A] = A;
  const [F_B, P_B] = B;
  const eA = p.eps - p.r_over_l * th;
  const eB = p.eps + p.r_over_l * th;
  const g0 = g(p.eps, p);
  let act;
  if (stim === "A") {
    act = (F_A * g(eA, p)) / g0 - (p.chi * F_B * g(eB, p)) / g0;
  } else if (stim === "B") {
    act = (p.chi * F_A * g(eA, p)) / g0 - (F_B * g(eB, p)) / g0;
  } else {
    act = 0.0;
  }
  return p.r * (act + P_A * h(eA, p) - P_B * h(eB, p)) - p.kappa * th;
}

// Balance angle (rad) the joint reaches from `start`, and the number of balance points on
// the scan.
//
// The joint follows the net torque: from `start`, walk the scan points in the direction the
// residual pushes (zero counts as positive) to the first one whose sign differs, then halve
// that bracket N_HALVINGS times. A crossing reached this way is always stable. n_roots counts
// the sign changes between neighbouring scan points. No sign change in that direction (the
// joint runs to its stop): [NaN, n_roots].
export function solve(A, B, stim, p, start) {
  const f = GRID.map((th) => residual(th, A, B, stim, p));
  let n_roots = 0;
  for (let k = 0; k < N_SCAN - 1; k++) {
    if (f[k] < 0 !== f[k + 1] < 0) n_roots += 1;
  }
  const start_neg = residual(start, A, B, stim, p) < 0;
  let near = start; // last point with the start's sign
  let far = NaN; // first point beyond it with the other sign
  const step = start_neg ? -1 : 1;
  for (let k = start_neg ? N_SCAN - 1 : 0; k >= 0 && k < N_SCAN; k += step) {
    const beyond = start_neg ? GRID[k] < start : GRID[k] > start;
    if (beyond) {
      if (f[k] < 0 !== start_neg) {
        far = GRID[k];
        break;
      }
      near = GRID[k];
    }
  }
  if (Number.isNaN(far)) return [NaN, n_roots];
  for (let i = 0; i < N_HALVINGS; i++) {
    const mid = 0.5 * (near + far);
    if ((residual(mid, A, B, stim, p) < 0) === start_neg) {
      near = mid;
    } else {
      far = mid;
    }
  }
  return [0.5 * (near + far), n_roots];
}

// Every balance point on the scan, located to the scan step: the midpoints of the brackets
// solve() counts. For the multi-root report (spec 02), not for the swing.
export function roots(A, B, stim, p) {
  const f = GRID.map((th) => residual(th, A, B, stim, p));
  const found = [];
  for (let k = 0; k < N_SCAN - 1; k++) {
    if (f[k] < 0 !== f[k + 1] < 0) {
      found.push(0.5 * (GRID[k] + GRID[k + 1]));
    }
  }
  return found;
}

// Rest angle (rad), no stimulation, searched from 0; and its root count.
export function rest(A, B, p) {
  return solve(A, B, null, p, 0.0);
}

// Stimulate A, starting from the rest angle. swing = th_stim - th_rest in deg.
export function swing(A, B, p) {
  const [th_rest, n_rest] = rest(A, B, p);
  const [th_stim, n_stim] = solve(A, B, "A", p, th_rest);
  return {
    swing: (th_stim - th_rest) * DEG,
    rest: th_rest,
    n_rest: n_rest,
    n_stim: n_stim,
  };
}

// Torque with the joint held at 0 and A stimulated: r (F_A - chi F_B).
export function blocked_torque(A, B, p) {
  const F_A = A[0];
  const F_B = B[0];
  return p.r * (F_A - p.chi * F_B);
}
