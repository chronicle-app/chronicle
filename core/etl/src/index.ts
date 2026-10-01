export { Extractor } from './extractor.js';
export { Transformer } from './transformer.js';
export { ChronicleTransformer } from './ChronicleTransformer.js';
export { NullTransformer } from './null-transformer.js';
export { FlattenTransformer } from './flatten-transformer.js';
export { DispatchingTransformer } from './DispatchingTransformer.js';
export { Loader } from './loader.js';
// Plugins extend Extractor.schema with the same zod, without depending on it.
export { z } from 'zod';
export { Runner, type RunnerConfig } from './runner.js';
export { RunReport, type RunStats } from './report.js';
export { JsonLoader, colorizeJson, type JsonColorTheme } from './json-loader.js';
export { CsvLoader } from './connectors/loaders/CsvLoader.js';
export { YamlLoader } from './connectors/loaders/YamlLoader.js';
export {
  LABELS,
  Rows,
  columnsOption,
  nodeLabel,
  recordRow,
  type Cell,
} from './connectors/loaders/columns.js';
export type { Delivery, Extraction, Transformation, Record, LoadResult, RunLog } from './types.js';
export {
  AuthRequired,
  EXIT_CODES,
  ExtractorError,
  InputNotFound,
  PermissionDenied,
  RateLimited,
  type ExtractorErrorOptions,
  Logger,
  createLogger,
  type LoggerOptions,
  type LogLevel,
  type LoggerContext,
  type OutputEvent,
  type ProgressFields,
  type RunContext,
  type SummaryFields,
  type Sink,
} from '@chronicle.app/logging';
export * from './selfAgent.js';
export * from './phone.js';
export * from './media.js';
export * from './FilterFieldsTransformer.js';
export * from './Base64TruncateTransformer.js';
export * from './DownloadAttachmentsTransformer.js';
export * from './connectors/transformers/DelayTransformer.js';
export * from './connectors/transformers/SamplingTransformer.js';
export * from './connectors/csv/CsvExtractor.js';
export * from './io-extractor-helper.js';
export { assertReadable, fileError } from './fileErrors.js';
export * from './utils/string.js';
export { ApiProxy, ApiAuthError, ApiRateLimitError, type ApiProxyOptions } from './api/ApiProxy.js';
export { delay, paginateByPage, paginateCursor, paginateOffset } from './api/pagination.js';

// HTML utilities — for the sources that hand us markup where the content
// should be (InMail, feed summaries, notes, email parts)
export {
  htmlToText,
  htmlToMarkdown,
  decodeEntities,
  looksLikeHtml,
  tokenizeHtml,
  type HtmlToken,
} from './utils/html.js';

export { MergingExtractor } from './MergingExtractor.js';
export {
  renderShapes,
  sampleTransform,
  shapesOf,
  type ShapeSample,
  type Shapes,
} from './shapes.js';
export { ArchiveExtractor } from './archive/ArchiveExtractor.js';
export { SystemInfo } from './system/SystemInfo.js';
