/**
 * The logo, in pieces that fit together: art as text (`art`), a grid of dots
 * to work with (`dots`), effects that bring art on over time (`effects`),
 * inks that color it (`color`), an animation that plays one and paints it
 * (`animation`), typing for words (`text`), the splash's looks (`styles`),
 * and the splash a command opens with (`splash`).
 */
export { LOGO, SLANT, WORDMARK, unrolledAt } from './art.js';
export { cell, fromBraille, toBraille, type Dots } from './dots.js';
export {
  EFFECTS,
  dissolve,
  gather,
  noise,
  resolve,
  rise,
  sequence,
  shimmer,
  spool,
  unroll,
  type Effect,
  type Frame,
} from './effects.js';
export { GRADIENT, RED, flat, gradient, hue, mix, print, type Ink } from './color.js';
export { Animation, beside, paint } from './animation.js';
export { typed, typeable, visible, visibleWidth } from './text.js';
export {
  SPLASH_STYLES,
  type Brush,
  type Column,
  type Intro,
  type SplashStyle,
  type SplashStyleName,
  type Step,
} from './styles.js';
export { Splash, type SplashOptions } from './splash.js';
