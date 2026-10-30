/** The one glyph set. No emoji, no boxes. */
export const glyphs = {
  success: '✓',
  failure: '✗',
  warning: '!',
  bullet: '·',
  arrow: '→',
  // A live line's current item, under it.
  child: '↳',
  // What to do next, under what it follows.
  hint: '✦',
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
  // A checklist's step that's waiting on the person.
  current: '●',
  // Each character of something typed in secret, like a token.
  secret: '*',
} as const;
