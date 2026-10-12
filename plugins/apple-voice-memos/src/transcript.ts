/** A transcript Voice Memos made of a recording. */
export interface Transcript {
  /** The text: every run joined. Empty when Voice Memos heard no speech. */
  text: string;
  /** The locale it was transcribed in, such as `en_CA`. */
  locale: string | null;
  /** Each run with when it was spoken, in seconds from the start of the recording. */
  segments: TranscriptSegment[];
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

interface Attributes {
  timeRange?: unknown;
}

/**
 * Parse the transcript JSON Voice Memos stores in a recording. Its
 * `attributedString` is a run of text, each followed by its attributes: either
 * `{runs: [text, i, …], attributeTable: [attributes, …]}`, where `i` indexes
 * the table, or `[text, attributes, …]` with the attributes inline. A
 * recording with no speech has `""`. Throws on any other shape.
 */
export function parseTranscript(json: string): Transcript {
  const parsed = JSON.parse(json) as { attributedString?: unknown; locale?: unknown };
  const locale = localeOf(parsed.locale);
  const string = parsed.attributedString;
  if (typeof string === 'string') return { text: string, locale, segments: [] };

  let pairs: Array<[unknown, Attributes | undefined]>;
  if (Array.isArray(string)) {
    pairs = alternate(string).map(([text, attributes]) => [text, attributes as Attributes]);
  } else if (isObject(string) && Array.isArray(string.runs)) {
    const table = Array.isArray(string.attributeTable) ? string.attributeTable : [];
    pairs = alternate(string.runs).map(([text, index]) => [
      text,
      typeof index === 'number' ? (table[index] as Attributes) : undefined,
    ]);
  } else {
    throw new Error('Unknown transcript shape');
  }

  let text = '';
  const segments: TranscriptSegment[] = [];
  for (const [run, attributes] of pairs) {
    if (typeof run !== 'string') throw new Error('Unknown transcript shape');
    text += run;
    const range = attributes?.timeRange;
    if (Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number') {
      segments.push({ text: run, start: range[0], end: range[1] });
    }
  }
  return { text, locale, segments };
}

/** `[a, b, c, d]` as `[[a, b], [c, d]]`. */
function alternate(items: unknown[]): Array<[unknown, unknown]> {
  const pairs: Array<[unknown, unknown]> = [];
  for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1]]);
  return pairs;
}

function localeOf(locale: unknown): string | null {
  if (!isObject(locale)) return null;
  return typeof locale.identifier === 'string' ? locale.identifier : null;
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
