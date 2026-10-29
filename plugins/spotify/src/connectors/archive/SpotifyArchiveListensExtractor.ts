import type { Record, Survey, SurveyOptions } from '@chronicle.app/etl';
import { FILES, SpotifyArchiveExtractor } from './SpotifyArchiveExtractor.js';
import type { SpotifyStream } from './types.js';

/** When a stream stopped, as Spotify writes it, or empty when it doesn't say. */
function stopOf(row: { ts?: unknown } | null | undefined): string {
  return typeof row?.ts === 'string' ? row.ts : '';
}

/** Two times as Spotify writes them, the later first. */
function laterFirst(x: string, y: string): number {
  return x < y ? 1 : x > y ? -1 : 0;
}

/** Streams by when they stopped, newest first. */
function newestFirst(a: { ts?: unknown }, b: { ts?: unknown }): number {
  return laterFirst(stopOf(a), stopOf(b));
}

/** A stream without the IP address and user agent Spotify logged with it, which nothing reads. */
function withoutAddresses(row: { [field: string]: unknown }): SpotifyStream {
  return Object.fromEntries(
    Object.entries(row).filter(([field]) => !/^(?:ip_addr|user_agent)/.test(field))
  ) as unknown as SpotifyStream;
}

/**
 * The extended streaming history: every song and episode the account
 * streamed since it began, each with when it stopped and how long it played,
 * in parts. Older downloads number the parts in order
 * (`Streaming_History_Audio_2023-2024_12.json`); newer ones name them by year,
 * with a count after the first (`Streaming_History_Audio_2024_1.json`).
 */
export class SpotifyArchiveListensExtractor extends SpotifyArchiveExtractor<
  typeof SpotifyArchiveListensExtractor
> {
  static override description = 'Every song and episode streamed';
  static override recordTypes = ['listens'];
  static override default = true;
  static override schema = SpotifyArchiveExtractor.schema;

  protected override readonly reads = FILES.streams;

  override occurredAt(record: Record): Date {
    return new Date((record.data as SpotifyStream).ts);
  }

  async *extract(): AsyncGenerator<Record> {
    if (this.pathsOf(FILES.streams).length === 0) {
      const accountData = [FILES.library, FILES.playlists, FILES.searches].some(
        name => this.pathsOf(name).length > 0
      );
      this.hint('This download has no extended streaming history', {
        action:
          'Request it at https://www.spotify.com/account/privacy, then pass its zip with `--input`.' +
          (accountData
            ? ' Add `-t all` to read the library, playlists, and searches in this one.'
            : ''),
      });
      return;
    }
    let count = 0;
    const streams = this.withTracks(this.streams(), stream => stream.spotify_track_uri);
    for await (const [stream, apiTrack] of streams) {
      if (this.shouldStopExtracting(count)) return;
      yield this.record('listens', apiTrack ? { ...stream, apiTrack } : stream, {
        occurredAt: new Date(stream.ts),
      });
      count++;
    }
  }

  /** The streams a run reads, when each stopped, how many tracks they were of, and how long they played. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const times: Date[] = [];
    const tracks = new Set<string>();
    let played = 0;
    for await (const stream of this.streams()) {
      times.push(new Date(stream.ts));
      if (stream.spotify_track_uri) tracks.add(stream.spotify_track_uri);
      played += stream.ms_played;
    }
    return {
      listens: {
        ...this.surveyOf(times, options),
        measures: [
          { key: 'tracks', label: 'tracks', value: tracks.size },
          {
            key: 'listenSeconds',
            label: 'listening',
            value: Math.round(played / 1000),
            unit: 'seconds',
          },
        ],
      },
    };
  }

  /**
   * The streams a run reads, newest first. Parts are read in order of their
   * newest stream, and a part's streams are held only until no unread part
   * could have a newer one, so parts that overlap at their edges, as one
   * year's last part and the next year's first can, still come out in order,
   * with about one part in memory at a time. A stream of nothing Spotify
   * names, such as a local file, and one that didn't play at all are left out.
   */
  private async *streams(): AsyncGenerator<SpotifyStream> {
    const parts: { path: string; newest: string }[] = [];
    for (const path of this.pathsOf(FILES.streams)) {
      const rows = await this.readJson(path);
      if (!Array.isArray(rows)) {
        this.logger.warn(`${path} isn't a list of streams, so it's skipped`);
        continue;
      }
      const newest = rows.reduce((max: string, row) => (stopOf(row) > max ? stopOf(row) : max), '');
      parts.push({ path, newest });
    }
    parts.sort((a, b) => laterFirst(a.newest, b.newest));
    let pending: any[] = [];
    let unnamed = 0;
    let unplayed = 0;
    for (const [i, part] of parts.entries()) {
      pending = [...pending, ...(await this.readJson(part.path))].sort(newestFirst);
      const next = parts[i + 1]?.newest ?? '';
      const held = pending.findIndex(row => stopOf(row) < next);
      const ready = held === -1 ? pending : pending.slice(0, held);
      pending = held === -1 ? [] : pending.slice(held);
      for (const row of ready) {
        if (!row?.spotify_track_uri && !row?.spotify_episode_uri) {
          unnamed++;
          continue;
        }
        if (!(row.ms_played > 0)) {
          unplayed++;
          continue;
        }
        const stoppedAt = new Date(row.ts);
        if (Number.isNaN(stoppedAt.getTime()) || !this.inRange(stoppedAt)) continue;
        yield withoutAddresses(row);
      }
    }
    if (unnamed + unplayed > 0) {
      this.logger.info(
        `Streaming history: left out ${unnamed} streams of no track or episode and ${unplayed} that didn't play`
      );
    }
  }
}
