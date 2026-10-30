import { wrap } from '../blocks.js';
import { glyphs } from '../glyphs.js';
import type { RGB, Style, Tokens } from '../tokens.js';
import { SLANT, WORDMARK, unrolledAt } from './art.js';
import { GRAY, PAPER, RED, gradient, hue, print, type Ink } from './color.js';
import { gather, resolve, rise, sequence, shimmer, spool, unroll, type Effect } from './effects.js';
import { visibleWidth } from './text.js';

/** A step of what's ahead: a word for it, and what it does, put tersely, as a man page names a command. */
export interface Step {
  name: string;
  description: string;
  /**
   * Where it stands, said by a mark in its number's place: done, waiting on
   * something else, or left to do. Steps with marks are a list of where
   * things stand, not steps in turn.
   */
  mark?: 'done' | 'waiting' | 'left';
}

/** What's ahead, said beside the logo: a title, any sentences, the steps, and a note to end on. */
export interface Intro {
  title: string;
  text?: string[];
  steps: Step[];
  note?: string;
}

/** What a column is drawn with: the style tokens, a style for any color, and its width. */
export interface Brush {
  t: Tokens;
  color: (rgb: RGB) => Style;
  width: number;
}

/** The column beside the logo: the name, then what's ahead. */
export interface Column {
  name: string[];
  body: string[];
}

/**
 * A look for the splash: how the logo comes on and in what ink, and the
 * column beside it, with the name and what's ahead, maybe typed out.
 */
export interface SplashStyle {
  summary: string;
  effect: Effect;
  ink: Ink;
  /** How long the logo takes to come on, in milliseconds. */
  duration: number;
  /** The column beside the logo, each line within the width. */
  column: (intro: Intro | undefined, brush: Brush) => Column;
  /**
   * Type the column out, from `delay` milliseconds in, `rate` characters a
   * second: what's ahead, and the name too when `name` says so.
   */
  typing?: { delay: number; rate: number; name?: boolean };
  /** Roll the column up into its place from below, like paper fed in, from `delay` over `duration` milliseconds. */
  feed?: { delay: number; duration: number };
}

/** A wordmark in one color, when it fits. */
function named(lines: string[], color: RGB, { color: paint, width }: Brush): string[] {
  return Math.max(...lines.map(line => visibleWidth(line))) <= width
    ? lines.map(line => paint(color)(line))
    : [];
}

/** A step's mark, in its number's place. */
const MARKS: Record<NonNullable<Step['mark']>, (t: Tokens) => string> = {
  done: t => t.success(glyphs.success),
  waiting: t => t.muted(glyphs.ellipsis),
  left: t => t.muted(glyphs.bullet),
};

/**
 * What's ahead as a walkthrough: its title, any sentences, its steps, each
 * numbered in the color `accent` gives it, its name in bold, a dash, and
 * what it does, the dashes lined up, and its note in light. Steps with
 * marks have them in place of numbers, and no dash.
 */
function walkthrough(
  intro: Intro | undefined,
  { t, color, width }: Brush,
  accent: (step: number, steps: number) => RGB = () => RED
): string[] {
  if (!intro) return [];
  const lines = ['', t.strong(intro.title)];
  for (const paragraph of intro.text ?? []) {
    for (const part of wrap(paragraph, width - 2)) lines.push(`  ${part}`);
  }
  if (intro.text?.length) lines.push('');
  const { steps } = intro;
  const names = Math.max(...steps.map(step => step.name.length));
  const marked = steps.some(step => step.mark);
  const lead = marked ? 1 : `${steps.length}`.length;
  const dash = marked ? '  ' : ' - ';
  // Where a description starts: after the number, the name, and the dash.
  const hang = 2 + lead + 2 + names + dash.length;
  for (const [i, { name, description, mark }] of steps.entries()) {
    const number = marked
      ? mark
        ? MARKS[mark](t)
        : ' '
      : color(accent(i, steps.length))(`${i + 1}`.padStart(lead));
    const named = `  ${number}  ${t.strong(name)}${' '.repeat(names - name.length)}${dash}`;
    for (const [j, part] of wrap(description, width - hang).entries()) {
      lines.push(j === 0 ? `${named}${part}` : `${' '.repeat(hang)}${part}`);
    }
  }
  if (intro.note) lines.push('', ...wrap(intro.note, width).map(part => t.muted(part)));
  return lines;
}

/** Deep crimson, through the red, to a warm amber: the gradient's range. */
const EMBER: RGB[] = [[140, 20, 50], RED, [250, 150, 80]];

/** Letters set apart, each its own color along the gradient, between rules. */
function spaced({ t, color, width }: Brush): string[] {
  const letters = [...'CHRONICLE'];
  const ink = gradient(EMBER, letters.length);
  const name = letters.map((letter, i) => color(ink(i, 0))(letter)).join('  ');
  const rule = t.muted('─'.repeat(Math.min(width, letters.length * 3 + 3)));
  return [rule, `  ${name}`, rule];
}

/**
 * A page of an old manual, set apart by weight alone: the name in bold red
 * over the tagline in light, a rule, then the walkthrough. Wide enough that
 * each step takes a line when there's room, so the page stays short beside
 * the logo.
 */
function manualPage(intro: Intro | undefined, brush: Brush): Column {
  const { t, color, width } = brush;
  const name = [t.strong(color(RED)('Chronicle')), t.muted('Own your data, own your history.')];
  const page = walkthrough(intro, { ...brush, width: Math.min(width, 64) });
  // The rule runs as far as the page's words do, and no further.
  const rule = Math.max(...[...name, ...page].map(line => visibleWidth(line)));
  return { name, body: [t.muted('─'.repeat(rule)), ...page] };
}

/** The splash's looks, by name. */
export const SPLASH_STYLES = {
  ink: {
    summary: 'Static settles into the logo, in red ink, beside the wordmark.',
    effect: resolve,
    ink: print(),
    duration: 900,
    column: (intro, brush) => ({
      name: named(WORDMARK, PAPER, brush),
      body: walkthrough(intro, brush),
    }),
  },
  paper: {
    summary: 'Static settles into the logo in red ink, as a page of the manual rolls up beside it.',
    effect: resolve,
    ink: print(),
    duration: 900,
    column: manualPage,
    feed: { delay: 100, duration: 1300 },
  },
  spool: {
    summary: 'Dots fly in white and cool to red, in the order the paper unrolls.',
    effect: spool(unrolledAt),
    ink: print(),
    duration: 1600,
    column: (intro, brush) => ({
      name: named(SLANT, GRAY, brush),
      body: walkthrough(intro, brush),
    }),
  },
  manual: {
    summary: 'The logo gathers while a page of the manual types out beside it.',
    effect: gather,
    ink: print(),
    duration: 1300,
    column: manualPage,
    typing: { delay: 150, rate: 260, name: true },
  },
  gradient: {
    summary: 'The logo rises from crimson to amber, and a light sweeps across it.',
    effect: sequence([rise, 3], [shimmer, 2]),
    ink: gradient(EMBER),
    duration: 1800,
    column(intro, brush) {
      const along = gradient(EMBER, 4);
      return { name: spaced(brush), body: walkthrough(intro, brush, step => along(step, 0)) };
    },
  },
  unroll: {
    summary: 'Paper comes off the roll and wraps the drum, and the words type in.',
    effect: unroll(unrolledAt),
    ink: hue(),
    duration: 1800,
    column: (intro, brush) => ({
      name: named(WORDMARK, PAPER, brush),
      body: walkthrough(intro, brush),
    }),
    typing: { delay: 600, rate: 320 },
  },
} satisfies Record<string, SplashStyle>;

export type SplashStyleName = keyof typeof SPLASH_STYLES;
