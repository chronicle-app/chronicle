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
  // A bar's end, by eighths of a character, an eighth to a whole block.
  eighths: '▏▎▍▌▋▊▉█',
  // Pickers: the highlighted option, and an option chosen or not.
  pointer: '❯',
  chosen: '◉',
  unchosen: '○',
} as const;
