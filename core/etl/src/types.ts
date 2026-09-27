/**
 * How a source's history reaches the archive. `export` and `api` are the two
 * pulls, `local` reads a file in place, and `direct` is the one value where
 * nothing is reached for — the app delivers itself.
 */
export type Delivery = 'export' | 'api' | 'local' | 'direct';

export interface Extraction {
  source: string;
  recordType?: string;
  delivery: Delivery;
  /**
   * 'event' (default) or 'snapshot'. A snapshot source re-reads current state,
   * so its records' attributes are sighted at read time, not at the historical
   * timestamps they carry (see Extractor.temporality).
   */
  temporality?: 'event' | 'snapshot';
  /**
   * The crawl/read "as of" time (ISO), kept as extraction metadata.
   */
  assertedAt?: string;
  /**
   * When the source observed this record (ISO), if the extractor knows — an
   * API's per-item fetch time, or when a backup was taken. It becomes the
   * payload's `@assertedAt` for either temporality, unless the payload sets one.
   */
  recordAssertedAt?: string;
}

export interface Transformation {
  name: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
  timestamp: Date;
}

export interface Record {
  extraction: Extraction;
  transformations: Transformation[];
  data: any;
  schema: string;
  context: any;
  toString: string;
}

export interface LoadResult {
  success: boolean;
  record: Record;
  error?: string;
}

/**
 * One entry per EXTRACTED record (not per transformed payload), so progress
 * counts records even when a transformer fans one record out into many
 * payloads. The payload-level outcomes ride along in `results`.
 */
export interface RunLog {
  record: Record;
  /** Load results for every transformed payload × loader. */
  results: LoadResult[];
  /** The transformer chain filtered the record by design (no payloads). */
  filtered?: boolean;
  /** Record-level failure (the transformer threw). */
  error?: string;
  /** Payloads dropped by schema validation before reaching a loader. */
  validationErrors?: string[];
}
