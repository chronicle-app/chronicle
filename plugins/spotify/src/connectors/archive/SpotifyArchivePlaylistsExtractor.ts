import type { Record, Survey, SurveyOptions } from '@chronicle.app/etl';
import { idOf } from '../../utils/uris.js';
import { dayOf, text } from './fields.js';
import { FILES, SpotifyArchiveExtractor } from './SpotifyArchiveExtractor.js';
import type { SpotifyPlaylistEntry } from './types.js';

/**
 * PlaylistN.json: the account's playlists and what's in them, each item with
 * the day it was added. The playlists have names but no IDs, and their names
 * and descriptions are as of the download.
 */
export class SpotifyArchivePlaylistsExtractor extends SpotifyArchiveExtractor<
  typeof SpotifyArchivePlaylistsExtractor
> {
  static override description = 'Songs and episodes added to playlists';
  static override recordTypes = ['playlist-tracks'];
  static override schema = SpotifyArchiveExtractor.schema;

  protected override readonly reads = FILES.playlists;

  override occurredAt(record: Record): Date | undefined {
    return dayOf((record.data as SpotifyPlaylistEntry).item.addedDate);
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    const entries = this.withTracks(await this.entries(), entry => entry.item.track?.trackUri);
    for await (const [entry, apiTrack] of entries) {
      if (this.shouldStopExtracting(count)) return;
      yield this.record('playlist-tracks', apiTrack ? { ...entry, apiTrack } : entry, {
        occurredAt: dayOf(entry.item.addedDate),
        asOfDownload: true,
      });
      count++;
    }
  }

  /** The playlist items a run reads, the day each was added, and how many playlists they're in. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const entries = await this.entries();
    const days = entries.map(entry => dayOf(entry.item.addedDate)!);
    const playlists = new Set(entries.map(entry => entry.playlist.name));
    return {
      'playlist-tracks': {
        ...this.surveyOf(days, options),
        measures: [{ key: 'playlists', label: 'playlists', value: playlists.size }],
      },
    };
  }

  /**
   * The playlist items a run reads, newest first by the day each was added:
   * tracks and episodes, not local files, which Spotify doesn't name.
   */
  private async entries(): Promise<SpotifyPlaylistEntry[]> {
    const entries: SpotifyPlaylistEntry[] = [];
    let unnamed = 0;
    for (const path of this.pathsOf(FILES.playlists)) {
      const { playlists } = (await this.readJson(path)) ?? {};
      for (const { items, ...playlist } of Array.isArray(playlists) ? playlists : []) {
        if (!text(playlist.name)) continue;
        for (const item of Array.isArray(items) ? items : []) {
          const added = dayOf(item?.addedDate);
          const named =
            idOf(item?.track?.trackUri, 'track') ?? idOf(item?.episode?.episodeUri, 'episode');
          if (!added || !named) {
            unnamed++;
            continue;
          }
          if (this.inRange(added)) entries.push({ playlist, item });
        }
      }
    }
    if (unnamed > 0) {
      this.logger.info(`Playlists: left out ${unnamed} items with no Spotify URI or date`);
    }
    return entries.sort((a, b) => b.item.addedDate.localeCompare(a.item.addedDate));
  }
}
