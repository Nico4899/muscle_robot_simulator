"""Seeded random numbers shared with rng.js (spec 01, Determinism).

mulberry32 (Tommy Ettinger, public domain) for uniforms, Box-Muller for normals. rng.js ports
this file line by line; parity needs the same integer steps and the same float formulas.
All integer state is kept as unsigned 32-bit; JS's signed int32 has the same bits.
"""
import math

MASK32 = 0xFFFFFFFF
TWO_POW_32 = 4294967296.0


def imul(a, b):
    """Low 32 bits of a * b, unsigned (Math.imul in JS)."""
    return (a * b) & MASK32


class Rng:
    def __init__(self, seed):
        self.state = seed & MASK32

    def uniform(self):
        """Next draw in [0, 1): one mulberry32 step."""
        self.state = (self.state + 0x6D2B79F5) & MASK32
        t = self.state
        t = imul(t ^ (t >> 15), t | 1)
        t = ((t + imul(t ^ (t >> 7), t | 61)) & MASK32) ^ t
        return (t ^ (t >> 14)) / TWO_POW_32

    def normal(self):
        """Standard normal from two uniforms: Box-Muller, cosine branch; the sine branch is
        discarded so each call uses exactly two uniforms and keeps no cached state."""
        u1 = 1.0 - self.uniform()  # in (0, 1], so log(u1) is finite
        u2 = self.uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
