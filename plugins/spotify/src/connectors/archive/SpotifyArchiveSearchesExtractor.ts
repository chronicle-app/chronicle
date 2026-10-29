import type { Record, Survey, SurveyOptions } from '@chronicle.app/etl';
import { searchedAt, text } from './fields.js';
import { FILES, SpotifyArchiveExtractor } from './SpotifyArchiveExtractor.js';
import type { SpotifySearch } from './types.js';

/** SearchQueries.json: the account's searches, each with when it was made. */
export class SpotifyArchiveSearchesExtractor extends SpotifyArchiveExtractor<
  typeof SpotifyArchiveSearchesExtractor
> {
  static override description = 'Searches';
  static override recordTypes = ['searches'];
  static override schema = SpotifyArchiveExtractor.schema;

  protected override readonly reads = FILES.searches;

  override occurredAt(record: Record): Date | undefined {
    return searchedAt(record.data as SpotifySearch);
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const search of await this.searches()) {
      if (this.shouldStopExtracting(count)) return;
      yield this.record('searches', search, { occurredAt: searchedAt(search) });
      count++;
    }
  }

  /** The searches a run reads, and when each was made. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const times = (await this.searches()).map(search => searchedAt(search)!);
    return { searches: this.surveyOf(times, options) };
  }

  /** The searches with a query and a time, inside since and until, newest first. */
  private async searches(): Promise<SpotifySearch[]> {
    const searches: SpotifySearch[] = [];
    for (const path of this.pathsOf(FILES.searches)) {
      const rows = await this.readJson(path);
      for (const search of Array.isArray(rows) ? (rows as SpotifySearch[]) : []) {
        const time = search && searchedAt(search);
        if (time && text(search.searchQuery) && this.inRange(time)) searches.push(search);
      }
    }
    return searches.sort((a, b) => searchedAt(b)!.getTime() - searchedAt(a)!.getTime());
  }
}
