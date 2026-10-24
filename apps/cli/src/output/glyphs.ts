/** The one glyph set. No emoji, no boxes. */
export const glyphs = {
  success: '✓',
  failure: '✗',
  warning: '!',
  bullet: '·',
  arrow: '→',
  child: '↳',
  bar: '━',
  rule: '─',
  ellipsis: '…',
  spinner: '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏',
  // A sparkline's columns, by eighths: an eighth of a row high to a whole one.
  levels: '▁▂▃▄▅▆▇█',
  // Pickers: the highlighted option, and an option chosen or not.
  pointer: '❯',
  chosen: '◉',
  unchosen: '○',
} as const;
