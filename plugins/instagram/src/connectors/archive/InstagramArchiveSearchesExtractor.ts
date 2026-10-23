import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/** One search a run reads, before it's a record. */
interface Search {
  kind: 'profile' | 'query';
  entry: any;
  value: string;
  timestamp: number;
}

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
    for await (const { kind, entry, value, timestamp } of this.searches()) {
      if (this.shouldStopExtracting(index)) return;

      yield this.createRecordWithArchiveContext(
        {
          type: 'searches',
          kind,
          ...(kind === 'profile'
            ? { handle: value }
            : { query: this.fixInstagramTextEncoding(value) }),
          timestamp: this.convertInstagramTimestamp(timestamp),
        },
        { originalData: entry }
      );
      index++;
    }
  }

  /** The searches a run reads and when each was made. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const searches = this.emptySurvey(options);
    for await (const { timestamp } of this.searches()) {
      this.tally(searches, new Date(timestamp * 1000));
    }
    return { searches };
  }

  /** The profile searches, then the keyword searches, in the run's window. */
  private async *searches(): AsyncGenerator<Search> {
    yield* this.searchesIn('logged_information/recent_searches/profile_searches.json', 'profile');
    yield* this.searchesIn(
      'logged_information/recent_searches/word_or_phrase_searches.json',
      'query'
    );
  }

  private async *searchesIn(file: string, kind: Search['kind']): AsyncGenerator<Search> {
    for (const entry of await this.readInstagramArray(file)) {
      const parsed = this.parseSearch(entry);
      if (!parsed) continue;
      if (!this.inRange(parsed.timestamp)) continue;
      yield { kind, entry, ...parsed };
    }
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
