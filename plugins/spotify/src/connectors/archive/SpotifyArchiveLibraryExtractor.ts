import type { Record, Survey } from '@chronicle.app/etl';
import { idOf, type SpotifyKind } from '../../utils/uris.js';
import { FILES, SpotifyArchiveExtractor } from './SpotifyArchiveExtractor.js';

/** Each list in YourLibrary.json a run reads, the record type it becomes, and the kind of URI its items have. */
const LISTS: [list: string, recordType: string, kind: SpotifyKind][] = [
  ['tracks', 'saved-tracks', 'track'],
  ['albums', 'saved-albums', 'album'],
  ['episodes', 'saved-episodes', 'episode'],
  ['artists', 'follows', 'artist'],
  ['shows', 'follows', 'show'],
];

/**
 * YourLibrary.json: what's in Your Library when Spotify wrote the download.
 * It says what's there but not since when, so its records are as of the
 * download, and since and until don't apply.
 */
export class SpotifyArchiveLibraryExtractor extends SpotifyArchiveExtractor<
  typeof SpotifyArchiveLibraryExtractor
> {
  static override description = 'Liked songs, saved albums and episodes, and follows';
  static override recordTypes = ['saved-tracks', 'saved-albums', 'saved-episodes', 'follows'];
  static override schema = SpotifyArchiveExtractor.schema;

  protected override readonly reads = FILES.library;

  /** The item's Spotify URI, the library's only ID for it. */
  override keyOf(record: Record): string | null {
    return (record.data as { uri?: string }).uri ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    const items = this.withTracks(await this.items(), ([recordType, item]) =>
      recordType === 'saved-tracks' ? item.uri : undefined
    );
    for await (const [[recordType, item], apiTrack] of items) {
      if (this.shouldStopExtracting(count)) return;
      yield this.record(recordType, apiTrack ? { ...item, apiTrack } : item, {
        asOfDownload: true,
      });
      count++;
    }
  }

  /** The items a run reads, counted alone: the library doesn't say when any were added. */
  override async survey(): Promise<Survey> {
    const asOf = this.asOfTime();
    const survey: Survey = {};
    for (const recordType of SpotifyArchiveLibraryExtractor.recordTypes) {
      survey[recordType] = { count: 0, asOf };
    }
    for (const [recordType] of await this.items()) survey[recordType].count++;
    return survey;
  }

  /**
   * Each item in the library a run reads, as `[record type, item]`: those
   * with a URI of their list's kind, so not a local file, which Spotify
   * doesn't name.
   */
  private async items(): Promise<[string, { uri: string }][]> {
    const items: [string, { uri: string }][] = [];
    let unnamed = 0;
    for (const path of this.pathsOf(FILES.library)) {
      const library = await this.readJson(path);
      for (const [list, recordType, kind] of LISTS) {
        const entries: unknown[] = Array.isArray(library?.[list]) ? library[list] : [];
        for (const item of entries as { uri?: unknown }[]) {
          if (idOf(item?.uri, kind)) items.push([recordType, item as { uri: string }]);
          else unnamed++;
        }
      }
    }
    if (unnamed > 0) this.logger.info(`Library: left out ${unnamed} items with no Spotify URI`);
    return items;
  }
}
