import { Record } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/**
 * Extract recent searches from an Instagram data export — one `searches`
 * stream over both files: `profile_searches.json` (a profile the account
 * looked up, by handle) and `word_or_phrase_searches.json` (a free-text
 * query). Both fold to a `FindAction`; the object is a handle-keyed `Agent`
 * for profiles, a name-keyed entity for queries.
 *
 * Instagram only exports the *recent* window (often a handful of entries), so
 * this stream accrues across periodic exports rather than backfilling.
 *
 * Two dialects per file: 2025 exports carry
 * `string_map_data: {Search: {value}, Time: {timestamp}}`; 2026 exports carry
 * `{title: <handle>, string_list_data: [{href, timestamp}]}`.
 */
export class InstagramArchiveSearchesExtractor extends InstagramArchiveExtractor {
  static override description = 'Recent profile and keyword searches';

  static override recordTypes = ['searches'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;

  async *extract(): AsyncGenerator<Record> {
    let index = 0;
    index = yield* this.extractFile(
      'logged_information/recent_searches/profile_searches.json',
      'profile',
      index
    );
    yield* this.extractFile(
      'logged_information/recent_searches/word_or_phrase_searches.json',
      'query',
      index
    );
  }

  private async *extractFile(
    file: string,
    kind: 'profile' | 'query',
    startIndex: number
  ): AsyncGenerator<Record, number> {
    let index = startIndex;
    for (const entry of await this.readInstagramArray(file)) {
      const parsed = this.parseSearch(entry);
      if (!parsed) continue;
      if (!this.inRange(parsed.timestamp)) continue;
      if (this.shouldStopExtracting(index)) return index;

      yield this.createRecordWithArchiveContext(
        {
          type: 'searches',
          kind,
          ...(kind === 'profile'
            ? { handle: parsed.value }
            : { query: this.fixInstagramTextEncoding(parsed.value) }),
          timestamp: this.convertInstagramTimestamp(parsed.timestamp),
        },
        { originalData: entry }
      );
      index++;
    }
    return index;
  }

  /** The searched value + time from either dialect. */
  private parseSearch(entry: any): { value: string; timestamp: number } | null {
    const sm = entry?.string_map_data;
    if (sm?.Search?.value && sm?.Time?.timestamp) {
      return { value: sm.Search.value, timestamp: sm.Time.timestamp };
    }
    const sld = entry?.string_list_data?.[0];
    const fromHref = sld?.href?.match(/instagram\.com\/(?:_u\/)?([^/?#]+)/)?.[1];
    const value = entry?.title || fromHref;
    if (value && sld?.timestamp) {
      return { value, timestamp: sld.timestamp };
    }
    return null;
  }
}
