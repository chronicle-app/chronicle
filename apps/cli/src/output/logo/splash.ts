import { truncate } from '../format.js';
import { glyphs } from '../glyphs.js';
import { LiveRegion } from '../live.js';
import { rgbStyles, type RGB, type Style, type Tokens } from '../tokens.js';
import { Animation, beside, paint } from './animation.js';
import { LOGO } from './art.js';
import { WHITE } from './color.js';
import { fromBraille } from './dots.js';
import { SPLASH_STYLES, type Intro, type SplashStyle } from './styles.js';
import { typeable, typed, visibleWidth } from './text.js';

/** Columns between the logo and what's beside it. */
const GAP = 4;
/** The narrowest the column beside the logo can be; narrower, it goes under. */
const ROOM = 30;
/** Milliseconds a spinner frame shows, as the live views' do. */
const SPIN = 80;
/** Where typing has got to. */
const HEAD = '█';

export interface SplashOptions {
  /** Its look. The default is `ink`. */
  style?: SplashStyle;
  /** What's ahead, beside the logo under the name: shown from the start and left with it. */
  intro?: Intro;
  /**
   * A question after everything, like `Press Enter to start`, shown from the
   * start and gone once it ends. Something else waits for the answer.
   */
  prompt?: string;
}

/**
 * The logo coming on, with the name beside it, live on stderr, in one of the
 * looks in `SPLASH_STYLES`. `play()` shows it through and leaves it. Or
 * something can go on meanwhile: `start()`, with what's happening if there's
 * something to say, and `end()` whenever it's done, which leaves it finished
 * wherever it got to. Whatever's said goes beside the logo, under the name;
 * with no room there, under the logo.
 */
export class Splash {
  private readonly style: SplashStyle;
  private readonly animation: Animation;
  private readonly region: LiveRegion;
  private readonly intro?: Intro;
  private readonly prompt?: string;
  private readonly color: (rgb: RGB) => Style = rgbStyles('stderr');
  private startedAt = 0;
  private text = '';
  private ended = false;

  constructor(
    private readonly t: Tokens,
    { style = SPLASH_STYLES.ink, intro, prompt }: SplashOptions = {}
  ) {
    this.style = style;
    this.animation = new Animation(fromBraille(LOGO), style.effect, style.duration);
    this.intro = intro;
    this.prompt = prompt;
    this.region = new LiveRegion(columns => this.lines(columns), { tick: 30 });
  }

  /** Whether it can be drawn in place on stderr: a terminal, not a dumb one, wider than the logo. */
  static fits(): boolean {
    const stream = process.stderr;
    return (
      Boolean(stream.isTTY) &&
      process.env.TERM !== 'dumb' &&
      (stream.columns ?? 80) > visibleWidth(LOGO[0])
    );
  }

  /** How long it takes to finish: the logo, and any typing or rolling in. */
  get duration(): number {
    const { typing, feed } = this.style;
    const characters = typing ? typeable(this.typeable(this.width()).typed) : 0;
    return Math.max(
      this.style.duration,
      typing ? typing.delay + (characters / typing.rate) * 1000 : 0,
      feed ? feed.delay + feed.duration : 0
    );
  }

  /** Show it through, and leave it once it's done. */
  async play(): Promise<void> {
    this.start();
    await new Promise(done => setTimeout(done, this.duration));
    this.end();
  }

  start(status = ''): void {
    this.text = status;
    this.startedAt = Date.now();
    this.region.start();
  }

  /** Say what's happening now. */
  status(text: string): void {
    this.text = text;
  }

  /** Leave it finished where it is, without what's happening or the question. */
  end(): void {
    this.ended = true;
    this.region.stop({ keep: true });
  }

  /** The column's width for the terminal's: beside the logo, or the whole width under it. */
  private width(columns = (process.stderr.columns || 80) - 1): number {
    const room = columns - visibleWidth(LOGO[0]) - GAP;
    return room >= ROOM ? room : columns;
  }

  /** The column, as what shows whole and what types out. */
  private typeable(width: number): { whole: string[]; typed: string[] } {
    const { name, body } = this.style.column(this.intro, { t: this.t, color: this.color, width });
    return this.style.typing?.name
      ? { whole: [], typed: [...name, ...body] }
      : { whole: name, typed: body };
  }

  /**
   * The logo as far as it's come, and in a column beside it: the name and
   * what's ahead, typed as far as they've got, then what's happening and the
   * question until it ends. The column sits in the logo's middle when it's
   * shorter; when it's taller, the logo sits in the middle of its page, above
   * what's happening and the question, so it stays put when they go.
   */
  private lines(columns: number): string[] {
    const elapsed = this.ended ? Number.POSITIVE_INFINITY : Date.now() - this.startedAt;
    const logo = paint(this.animation.frame(elapsed), this.style.ink, this.color);
    const width = this.width(columns);
    const { whole, typed: typing } = this.typeable(width);
    let body = typing;
    const { typing: pace } = this.style;
    if (pace && elapsed < Number.POSITIVE_INFINITY) {
      const count = Math.max(0, ((elapsed - pace.delay) / 1000) * pace.rate);
      if (count < typeable(body)) body = typed(body, Math.floor(count), this.color(WHITE)(HEAD));
    }
    let words = [...whole, ...body];
    const { feed } = this.style;
    if (feed && elapsed < Number.POSITIVE_INFINITY) {
      // Rolled up from below, slowing as it settles: what's not in yet is under the column's edge.
      const k = Math.min(1, Math.max(0, (elapsed - feed.delay) / feed.duration));
      const below = Math.round((1 - k) ** 3 * words.length);
      words = [...Array.from({ length: below }, () => ''), ...words].slice(0, words.length);
    }
    const page = words.length;
    if (!this.ended && this.text !== '') {
      const spinner = glyphs.spinner[Math.floor(elapsed / SPIN) % glyphs.spinner.length];
      words.push('', `${this.t.accent(spinner)} ${truncate(this.text, width - 2)}`);
    }
    if (this.prompt && !this.ended) {
      const keys = ['enter continue', 'esc cancel'].join(` ${glyphs.bullet} `);
      words.push(
        '',
        `${this.t.accent(glyphs.pointer)} ${this.t.strong(truncate(this.prompt, width - 2))}`,
        '',
        this.t.muted(truncate(keys, width))
      );
    }
    if (width === columns) return [...logo, '', ...words];
    if (page > logo.length) {
      const down = Array.from({ length: Math.floor((page - logo.length) / 2) }, () => '');
      return beside([...down, ...logo], words, { gap: GAP });
    }
    const top = Math.max(0, Math.floor((logo.length - words.length) / 2));
    return beside(logo, words, { gap: GAP, top });
  }
}
