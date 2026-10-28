/**
 * A grid of braille dots, `width` across and `height` down, which `on` says
 * are lit. Each braille character holds two across and four down.
 */
export interface Dots {
  width: number;
  height: number;
  on(x: number, y: number): boolean;
}

/** Each dot of a braille character: its place in the character, and its bit. */
const BITS: [x: number, y: number, bit: number][] = [
  [0, 0, 1],
  [0, 1, 2],
  [0, 2, 4],
  [1, 0, 8],
  [1, 1, 16],
  [1, 2, 32],
  [0, 3, 64],
  [1, 3, 128],
];

const BLANK = 0x28_00;

/** The dots braille lines draw. A character that isn't braille has none. */
export function fromBraille(lines: string[]): Dots {
  const width = Math.max(...lines.map(line => [...line].length)) * 2;
  const lit = Array.from({ length: lines.length * 4 }, () =>
    Array.from({ length: width }, () => false)
  );
  for (const [row, line] of lines.entries()) {
    for (const [column, char] of [...line].entries()) {
      const code = char.codePointAt(0)! - BLANK;
      if (code <= 0 || code > 0xff) continue;
      for (const [dx, dy, bit] of BITS) {
        if (Math.floor(code / bit) % 2 === 1) lit[row * 4 + dy][column * 2 + dx] = true;
      }
    }
  }
  return { width, height: lit.length, on: (x, y) => lit[y]?.[x] ?? false };
}

/** The braille character for the cell `column` across and `row` down: a space with no dots. */
export function cell(dots: Dots, column: number, row: number): string {
  // Each dot has a bit of its own, so they add.
  const code = BITS.reduce(
    (n, [dx, dy, bit]) => (dots.on(column * 2 + dx, row * 4 + dy) ? n + bit : n),
    0
  );
  return code ? String.fromCodePoint(BLANK + code) : ' ';
}

/** Dots as braille lines, a character for each two across and four down. */
export function toBraille(dots: Dots): string[] {
  return Array.from({ length: Math.ceil(dots.height / 4) }, (_, row) =>
    Array.from({ length: Math.ceil(dots.width / 2) }, (_, column) => cell(dots, column, row)).join(
      ''
    )
  );
}
