import type { Dots } from './dots.js';

/**
 * What to show of art at one moment: its dots, and how far each braille
 * cell glows toward white, from 0 (its ink) to 1, when any do.
 */
export interface Frame {
  dots: Dots;
  glow?: (column: number, row: number) => number;
}

/**
 * How art comes on screen: given the art, the frame to show at `t`, from 0
 * as it starts to 1, which is the art itself. Only `t` decides it, so an
 * animation plays an effect at any length and frame rate, and a new effect
 * is a function like these.
 */
export type Effect = (art: Dots) => (t: number) => Frame;

/** A number in 0..1 for a dot and a salt: random to look at, the same each time it's asked. */
export function noise(x: number, y: number, salt = 0): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43_758.5453;
  return n - Math.floor(n);
}

/** The art's area, each dot lit as `on` says. */
const over = (art: Dots, on: (x: number, y: number) => boolean): Dots => ({
  width: art.width,
  height: art.height,
  on,
});

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** Fast, then easing into place. */
const easeOut = (k: number) => 1 - (1 - k) ** 3;

/** How many times a resolving dot flickers on its way to the art. */
const STEPS = 28;

/**
 * Static that settles into the art. Every dot of its area flickers, leaning
 * further toward what it is in the art at each step, until it settles at a
 * moment of its own.
 */
export const resolve: Effect = art => t => {
  const step = Math.floor(clamp(t) * STEPS);
  const lean = step / STEPS;
  return {
    dots: over(art, (x, y) => {
      const wanted = art.on(x, y);
      if (lean >= noise(x, y, 1) ** 0.7) return wanted;
      return noise(x, y, step + 2) < 0.5 + (wanted ? 0.45 : -0.45) * lean;
    }),
  };
};

/** The art's dots, each coming on at a moment of its own. */
export const dissolve: Effect = art => t => ({
  dots: over(art, (x, y) => art.on(x, y) && noise(x, y, 1) < t),
});

/** The art built up from the bottom, each row coming on a little later to the right. */
export const rise: Effect = art => t => {
  const span = art.height + art.width * 0.3 + 4;
  return { dots: over(art, (x, y) => art.on(x, y) && art.height - y + x * 0.3 < t * span) };
};

/** Each of the art's dots, where it starts, where it lands, and when it sets off. */
interface Flight {
  from: [number, number];
  to: [number, number];
  /** When it leaves, for `gather`, or lands, for `spool`, from 0 to 1. */
  at: number;
}

function flights(art: Dots, at: (x: number, y: number) => number): Flight[] {
  const all: Flight[] = [];
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      if (!art.on(x, y)) continue;
      const from: [number, number] = [
        noise(x, y, 11) * (art.width - 1),
        noise(x, y, 13) * (art.height - 1),
      ];
      all.push({ from, to: [x, y], at: at(x, y) });
    }
  }
  return all;
}

/** Where a flight is, `k` of the way, as a dot. */
const along = ({ from, to }: Flight, k: number) =>
  Math.round(from[1] + (to[1] - from[1]) * k) * 10_000 +
  Math.round(from[0] + (to[0] - from[0]) * k);

/** Dots scattered over the art's area fly to their places, setting off a little apart. */
export const gather: Effect = art => {
  const all = flights(art, (x, y) => noise(x, y, 17) * 0.25);
  return t => {
    const lit = new Set(all.map(f => along(f, easeOut(clamp((t - f.at) / (1 - f.at))))));
    return { dots: over(art, (x, y) => lit.has(y * 10_000 + x)) };
  };
};

/** How much of a spool each dot spends in flight. */
const FLIGHT = 0.3;

/**
 * Gather, in the order `when` gives the dots, like the order paper unrolls:
 * each in flight glows white, and cools to its ink as it lands.
 */
export const spool =
  (when: (x: number, y: number) => number | undefined): Effect =>
  art => {
    const all = flights(art, (x, y) => when(x, y) ?? 1);
    return t => {
      const lit = new Set<number>();
      const hot = new Set<number>();
      for (const f of all) {
        const land = f.at * (1 - FLIGHT) + FLIGHT;
        const k = easeOut(clamp((t - (land - FLIGHT)) / FLIGHT));
        const dot = along(f, k);
        lit.add(dot);
        const [x, y] = [dot % 10_000, Math.floor(dot / 10_000)];
        if ((k > 0.35 && k < 1) || (k === 1 && t - land < 0.04))
          hot.add(Math.floor(y / 4) * 1000 + Math.floor(x / 2));
      }
      return {
        dots: over(art, (x, y) => lit.has(y * 10_000 + x)),
        glow: (column, row) => (hot.has(row * 1000 + column) ? 1 : 0),
      };
    };
  };

/**
 * Paper coming off the roll, in the order `when` gives the dots, its
 * leading edge glowing white.
 */
export const unroll =
  (when: (x: number, y: number) => number | undefined): Effect =>
  art =>
  t => ({
    dots: over(art, (x, y) => art.on(x, y) && (when(x, y) ?? 1) <= t),
    glow(column, row) {
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const at = when(column * 2 + dx, row * 4 + dy);
          if (at !== undefined && t < 1 && at <= t && at > t - 0.06) return 1;
        }
      }
      return 0;
    },
  });

/** The art whole, with a light sweeping across it from its top left. */
export const shimmer: Effect = art => {
  const columns = art.width / 2;
  const rows = art.height / 4;
  return t => {
    const at = t * (columns + rows * 2 + 12) - 6;
    return {
      dots: art,
      // A band of light about six cells wide, brightest in its middle.
      glow: (column, row) =>
        t >= 1 ? 0 : 0.85 * Math.max(0, 1 - Math.abs(column + row * 2 - at) / 6),
    };
  };
};

/** Effects one after another, each taking its share of the time. */
export function sequence(...parts: [effect: Effect, share: number][]): Effect {
  const total = parts.reduce((n, [, share]) => n + share, 0);
  return art => {
    const played = parts.map(([effect, share]) => [effect(art), share / total] as const);
    return t => {
      let start = 0;
      for (const [frame, share] of played) {
        if (t < start + share) return frame(clamp((t - start) / share));
        start += share;
      }
      return played.at(-1)![0](1);
    };
  };
}

export const EFFECTS = { resolve, dissolve, rise, gather, shimmer };
