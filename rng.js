// Seeded random numbers shared with rng.py (spec 01, Determinism). Port of rng.py, line by line.
//
// mulberry32 (Tommy Ettinger, public domain) for uniforms, Box-Muller for normals.
// All integer state is kept as unsigned 32-bit (>>> 0), matching rng.py's & MASK32.

export const TWO_POW_32 = 4294967296.0;

// Low 32 bits of a * b, unsigned.
export function imul(a, b) {
  return Math.imul(a, b) >>> 0;
}

export class Rng {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  // Next draw in [0, 1): one mulberry32 step.
  uniform() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = imul((t ^ (t >>> 15)) >>> 0, (t | 1) >>> 0);
    t = (((t + imul((t ^ (t >>> 7)) >>> 0, (t | 61) >>> 0)) >>> 0) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
  }

  // Standard normal from two uniforms: Box-Muller, cosine branch; the sine branch is
  // discarded so each call uses exactly two uniforms and keeps no cached state.
  normal() {
    const u1 = 1.0 - this.uniform(); // in (0, 1], so log(u1) is finite
    const u2 = this.uniform();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
}
