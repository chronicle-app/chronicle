/* eslint-disable no-bitwise, unicorn/prefer-math-trunc, unicorn/numeric-separators-style, operator-assignment -- a PRNG is intrinsically bitwise */
/** Seeded PRNG + shuffle, so permutation runs are reproducible from a seed. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent sub-seed for order k from a master seed. */
export function subSeed(seed: number, k: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(k, 0xc2b2ae35)) >>> 0;
}

/** Fisher-Yates shuffle using a seeded rng (does not mutate input). */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
