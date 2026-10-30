/**
 * The only place terminal text is styled. Blocks and formatters return
 * strings, so plain commands and Ink screens can both use them. See README.md
 * for the style guide.
 */
export {
  tokens,
  plainTokens,
  colorLevel,
  jsonColors,
  THEMES,
  type Tokens,
  type Style,
  type RGB,
  rgbStyles,
  type JsonColors,
} from './tokens.js';
export { glyphs } from './glyphs.js';
export {
  bytes,
  count,
  duration,
  clock,
  plural,
  date,
  truncate,
  truncatePath,
  relativePath,
} from './format.js';
export {
  line,
  summary,
  hint,
  guide,
  heading,
  paragraph,
  definitions,
  list,
  caption,
  card,
  table,
  wrap,
  type Definition,
  type Segment,
  type SummaryFields,
  type TableInput,
} from './blocks.js';
export { progress, LiveRegion, LiveView, type ProgressFields } from './live.js';
export {
  LOGO,
  WORDMARK,
  Animation,
  EFFECTS,
  SPLASH_STYLES,
  Splash,
  beside,
  fromBraille,
  paint,
  toBraille,
  type Dots,
  type Effect,
  type Intro,
  type SplashStyle,
  type SplashStyleName,
  type Step,
} from './logo/index.js';
// The prompts (`./prompts.js`) are imported on their own, only where a
// question is asked, so other commands don't load what draws them.
export {
  render,
  createSink,
  sinkFor,
  stdoutWidth,
  canAsk,
  outputFlagsIn,
  defaultLogFormat,
  PrettySink,
  PlainSink,
  LOG_FORMATS,
  type LogFormat,
  type OutputOptions,
  type OutputFlags,
  type Live,
} from './sinks.js';
