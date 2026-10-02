import chalk from 'chalk';

export type Style = (text: string) => string;

/**
 * Color roles. Color carries meaning only: status (success, danger,
 * warning), emphasis (strong), de-emphasis (muted), and one accent for
 * live elements.
 */
export interface Tokens {
  accent: Style;
  success: Style;
  danger: Style;
  warning: Style;
  muted: Style;
  strong: Style;
  /**
   * A flag or name inside a sentence, written as a `code span`: cyan with
   * color; without, the backticks stay, since they're all that mark it.
   */
  code: Style;
  /** A command on a line of its own, to copy: cyan with color, bare without. */
  command: Style;
}

export type Stream = 'stdout' | 'stderr';

export const THEMES = ['default', 'minimal', 'high-contrast'] as const;

/** The brand red. */
const ACCENT = '#DE4F4F';

/** Colors `stream` can show: none under `NO_COLOR` or when it isn't a color terminal. */
export function colorLevel(stream: Stream): chalk.Level {
  if (process.env.NO_COLOR) return 0;
  return (stream === 'stderr' ? chalk.stderr : chalk).level;
}

export interface TokenOptions {
  stream?: Stream;
  /** `default`, `minimal`, or `high-contrast` (`--theme`). */
  theme?: string;
  /** Force color on or off instead of detecting it from the stream. */
  color?: boolean;
}

/** The color roles for text bound for `stream`, in `theme`. */
export function tokens({ stream = 'stderr', theme = 'default', color }: TokenOptions = {}): Tokens {
  const level = color === undefined ? colorLevel(stream) : color ? 3 : 0;
  const c = new chalk.Instance({ level });
  const base: Tokens = {
    accent: c.hex(ACCENT),
    success: c.green,
    danger: c.red,
    warning: c.yellow,
    muted: c.dim,
    strong: c.bold,
    code: level > 0 ? c.cyan : text => `\`${text}\``,
    command: c.cyan,
  };
  switch (theme.toLowerCase()) {
    case 'minimal':
      // Status keeps its color; the accent is only emphasis.
      return { ...base, accent: c.bold };
    case 'high-contrast':
    case 'highcontrast':
      // Nothing dimmed: de-emphasis is plain text, emphasis bright.
      return {
        ...base,
        success: c.greenBright,
        danger: c.redBright,
        warning: c.yellowBright,
        muted: text => text,
        strong: c.bold.whiteBright,
        code: level > 0 ? c.cyanBright : text => `\`${text}\``,
        command: c.cyanBright,
      };
    default:
      return base;
  }
}

/** Tokens that style nothing: for files, and for the plain sink. */
export const plainTokens: Tokens = tokens({ color: false });
