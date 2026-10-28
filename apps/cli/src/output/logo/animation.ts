import type { RGB, Style } from '../tokens.js';
import { WHITE, mix, type Ink } from './color.js';
import { cell, type Dots } from './dots.js';
import type { Effect, Frame } from './effects.js';
import { visibleWidth } from './text.js';

/**
 * Art brought on by an effect over `duration` milliseconds: its frame at any
 * moment, and the art itself once it's over.
 */
export class Animation {
  private readonly at: (t: number) => Frame;

  constructor(
    art: Dots,
    effect: Effect,
    readonly duration: number
  ) {
    this.at = effect(art);
  }

  /** The frame `elapsed` milliseconds in. */
  frame(elapsed: number): Frame {
    return this.at(Math.min(1, Math.max(0, elapsed / this.duration)));
  }
}

/**
 * A frame as braille lines, each cell in its ink, glowing toward white as
 * far as the frame says. Uncolored without `color`.
 */
export function paint(frame: Frame, ink?: Ink, color?: (rgb: RGB) => Style): string[] {
  const { dots, glow } = frame;
  return Array.from({ length: Math.ceil(dots.height / 4) }, (_, row) =>
    Array.from({ length: Math.ceil(dots.width / 2) }, (_, column) => {
      const char = cell(dots, column, row);
      if (char === ' ' || !ink || !color) return char;
      return color(mix(ink(column, row), WHITE, glow?.(column, row) ?? 0))(char);
    }).join('')
  );
}

/**
 * Two blocks of lines side by side: `right` begins `top` lines down, `gap`
 * columns after `left`, whose lines are as wide as each other. As many lines
 * as the taller block takes. Lines may be styled.
 */
export function beside(
  left: string[],
  right: string[],
  { gap = 4, top = 0 }: { gap?: number; top?: number } = {}
): string[] {
  const width = Math.max(0, ...left.map(line => visibleWidth(line)));
  const height = Math.max(left.length, top + right.length);
  return Array.from({ length: height }, (_, i) => {
    const after = right[i - top];
    const before = left[i] ?? '';
    if (after === undefined) return before;
    return `${before}${' '.repeat(width - visibleWidth(before) + gap)}${after}`;
  });
}
