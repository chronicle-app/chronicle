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
  type JsonColors,
} from './tokens.js';
export { glyphs } from './glyphs.js';
export { count, duration, clock, plural, date, truncate, relativePath } from './format.js';
export {
  line,
  summary,
  hint,
  heading,
  paragraph,
  definitions,
  list,
  caption,
  card,
  table,
  type Definition,
  type Segment,
  type SummaryFields,
  type TableInput,
} from './blocks.js';
export { progress, LiveView, type ProgressFields } from './live.js';
// The prompts (`./prompts.js`) are imported on their own, only where a
// question is asked, so other commands don't load what draws them.
export {
  render,
  createSink,
  sinkFor,
  stdoutWidth,
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
