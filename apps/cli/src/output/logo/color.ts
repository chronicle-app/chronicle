import type { RGB } from '../tokens.js';
import { noise } from './effects.js';

export type { RGB } from '../tokens.js';

/** The brand red, the CLI's accent. */
export const RED: RGB = [222, 79, 79];
export const WHITE: RGB = [255, 255, 255];
/** A light gray for words beside the red, and a quieter one. */
export const PAPER: RGB = [222, 222, 228];
export const GRAY: RGB = [150, 150, 160];
/** The brand red's range: deep crimson, the red, a warm coral. */
export const GRADIENT: RGB[] = [[176, 38, 58], RED, [240, 128, 92]];

/** The color of each braille cell of art, `column` across and `row` down. */
export type Ink = (column: number, row: number) => RGB;

/** `a` toward `b` by `k`, from 0 (all `a`) to 1 (all `b`). */
export function mix(a: RGB, b: RGB, k: number): RGB {
  return a.map((v, i) => Math.round(v + (b[i] - v) * k)) as RGB;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** Eased from 0 to 1, slow at each end. */
const smooth = (v: number) => v * v * (3 - 2 * v);

/** Smooth noise in 0..1 over cells, changing every `scale` rows (cells are twice as tall as wide). */
function patch(x: number, y: number, scale: number, salt = 0): number {
  const fx = x / (scale * 2);
  const fy = y / scale;
  const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
  const [tx, ty] = [smooth(fx - x0), smooth(fy - y0)];
  const n = (a: number, b: number) => noise(a, b, salt + 7);
  const top = n(x0, y0) * (1 - tx) + n(x0 + 1, y0) * tx;
  const bottom = n(x0, y0 + 1) * (1 - tx) + n(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** A color as hue, lightness, and saturation, each 0 to 1. */
function toHls([r, g, b]: RGB): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const high = Math.max(rr, gg, bb);
  const low = Math.min(rr, gg, bb);
  const l = (high + low) / 2;
  if (high === low) return [0, l, 0];
  const d = high - low;
  const s = l > 0.5 ? d / (2 - high - low) : d / (high + low);
  const h =
    high === rr
      ? (gg - bb) / d + (gg < bb ? 6 : 0)
      : high === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4;
  return [h / 6, l, s];
}

function fromHls(h: number, l: number, s: number): RGB {
  [l, s] = [clamp(l), clamp(s)];
  if (s === 0) return [l, l, l].map(v => Math.round(v * 255)) as RGB;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [h + 1 / 3, h, h - 1 / 3].map(t => Math.round(channel(t) * 255)) as RGB;
}

/** One color everywhere. */
export const flat =
  (color: RGB = RED): Ink =>
  () =>
    color;

/** Ink on paper: heavier and lighter patches, and a fine grain, like uneven letterpress. */
export const print =
  (color: RGB = RED): Ink =>
  (x, y) => {
    const [h, l, s] = toHls(color);
    const grain = noise(x, y, 3) - 0.5;
    const density = patch(x, y, 3) - 0.5;
    return fromHls(h, l + density * 0.3 + grain * 0.08, s * (1 - Math.max(0, density) * 0.3));
  };

/** Patches drifting between crimson and vermilion, with a fine grain. */
export const hue =
  (color: RGB = RED): Ink =>
  (x, y) => {
    const [h, l, s] = toHls(color);
    return fromHls(h + (patch(x, y, 4, 3) - 0.5) * 0.08, l + (noise(x, y, 3) - 0.5) * 0.08, s);
  };

/** A color for each column, from the first stop to the last across `columns`. */
export const gradient =
  (stops: RGB[] = GRADIENT, columns = 22): Ink =>
  x => {
    const at = Math.min(1, Math.max(0, x / Math.max(1, columns - 1))) * (stops.length - 1);
    const i = Math.min(Math.floor(at), stops.length - 2);
    return mix(stops[i], stops[i + 1], at - i);
  };
