import { Record } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  getRow,
  iterateRows,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import { AppleMusicLookup, LOOKUP_BATCH, countryOf, type AppleMusicArtist } from '../appleMusic.js';
import { unarchive } from '../archive.js';
import ShazamTransformer from './ShazamTransformer.js';

const DEFAULT_DB = `${process.env.HOME}/Library/Application Support/com.apple.shazamd/ShazamLibrary.sqlite`;

// since/until bounds land on ZDATE, which is seconds since the Apple epoch.
const appleBound = (date: Date) => unixToSafariTimestamp(date.getTime() / 1000);

/** One Shazam as the library row gives it, named after the row's Core Data attributes. */
export interface Shazam {
  recognitionID: string;
  syncID: string | null;
  /** When the song was recognized, in UTC. */
  date: string;
  /** The title and artist line as Shazam words them. */
  title: string | null;
  subtitle: string | null;
  shazamKey: string | null;
  shazamURL: string | null;
  providerName: string | null;
  latitude: number | null;
  longitude: number | null;
  artworkURL: string | null;
  // The rest is Apple Music's catalog entry for the song, when it has one.
  appleMusicID: string | null;
  appleMusicURL: string | null;
  isrc: string | null;
  albumName: string | null;
  /** A day, `YYYY-MM-DD`. */
  releaseDate: string | null;
  explicit: boolean | null;
  genres: string[];
  /** Apple Music's song resource (`id`, `attributes`), decoded from `rawSongResponse`. */
  song: { id?: string; attributes?: { [key: string]: unknown } } | null;
  /** The song's main artist on Apple Music, looked up with `linkArtists`. */
  appleMusicArtist?: AppleMusicArtist;
}

/**
 * The Shazam library that macOS keeps for Music Recognition (`shazamd`). It
 * mirrors the iCloud library the Shazam app syncs to, so it holds the songs
 * recognized on every device signed in to the account.
 */
export class ShazamExtractor extends SqliteExtractor<typeof ShazamExtractor> {
  static override source = 'shazam';
  static override description = 'Songs you identified with Shazam';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['listens'];
  static override default = true;
  static override defaultTransformer = ShazamTransformer;
  static override newestFirst = true;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe('Path to ShazamLibrary.sqlite').default(DEFAULT_DB),
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
    linkArtists: z
      .boolean()
      .optional()
      .describe(
        "Look up each song's main artist on Apple Music, to link artists by their Apple Music ID"
      ),
  }) as any;

  private lookup?: AppleMusicLookup;

  override async setup(): Promise<void> {
    await super.setup();
    if (!this.config.linkArtists) return;
    this.lookup = new AppleMusicLookup({
      info: message => this.logger.info(message),
      failure: error => {
        this.logger.warn(`Can't look up artists on Apple Music: ${error.message}`);
        this.hint("Can't reach Apple Music, so some artists aren't linked", {
          action: 'Check your connection and run `chronicle extract shazam --link-artists` again.',
        });
      },
    });
  }

  /** The recognition ID: the same ID the Shazam app gives the Shazam on every device. */
  override keyOf(record: Record): string | null {
    return (record.data as Shazam).recognitionID ?? null;
  }

  override occurredAt(record: Record): Date | undefined {
    return new Date((record.data as Shazam).date);
  }

  // A sync can write the same Shazam twice, so take one row per recognition
  // ID: the most recently modified.
  private query(select: string): { sql: string; values: Array<number | string> } {
    const range = timeRangeConditions('ZDATE', this.config, { convert: appleBound });
    const where = ['copy = 1', ...range.conditions].join(' AND ');
    const sql = `
      WITH shazams AS (
        SELECT *, COALESCE(ZRECOGNITIONID, ZSYNCID) AS id,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(ZRECOGNITIONID, ZSYNCID)
                 ORDER BY ZMODIFIEDDATE DESC, Z_PK DESC
               ) AS copy
        FROM ZSHTRACKMO
        WHERE COALESCE(ZRECOGNITIONID, ZSYNCID) IS NOT NULL AND ZDATE IS NOT NULL
      )
      SELECT ${select} FROM shazams WHERE ${where}`;
    return { sql, values: range.values };
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const { sql, values } = this.query(`
      id, ZSYNCID AS syncID, ZDATE AS date, ZTITLE AS title, ZSUBTITLE AS subtitle,
      ZSHAZAMKEY AS shazamKey, ZSHAZAMURL AS shazamURL, ZPROVIDERNAME AS providerName,
      ZLATITUDE AS latitude, ZLONGITUDE AS longitude, ZARTWORKURL AS artworkURL,
      ZAPPLEMUSICID AS appleMusicID, ZAPPLEMUSICURL AS appleMusicURL, ZISRC AS isrc,
      ZALBUMNAME AS albumName, ZRELEASEDATE AS releaseDate, ZEXPLICIT AS explicit,
      ZGENRES AS genres, ZRAWSONGRESPONSE AS rawSongResponse`);
    let ordered = `${sql} ORDER BY ZDATE DESC`;
    const limit = this.getEffectiveLimit();
    if (limit !== null) {
      ordered += ' LIMIT ?';
      values.push(limit);
    }

    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    // With linkArtists, Shazams go out a batch at a time, after their lookups.
    let batch: Shazam[] = [];
    for (const row of iterateRows<any>(this.db.prepare(ordered), ...values)) {
      batch.push(this.shazamOf(row));
      if (batch.length < (this.lookup ? LOOKUP_BATCH : 1)) continue;
      yield* await this.recordsOf(batch, account);
      batch = [];
    }
    yield* await this.recordsOf(batch, account);
  }

  private async recordsOf(shazams: Shazam[], account: unknown): Promise<Record[]> {
    if (this.lookup) {
      const songs = shazams
        .filter(shazam => shazam.appleMusicID)
        .map(shazam => ({ id: shazam.appleMusicID!, country: countryOf(shazam.appleMusicURL) }));
      const artists = await this.lookup.artistsOf(songs);
      for (const shazam of shazams) {
        const artist = artists.get(shazam.appleMusicID ?? '');
        if (artist) shazam.appleMusicArtist = artist;
      }
    }
    return shazams.map(shazam => this.createRecord(shazam, { account }));
  }

  private shazamOf(row: any): Shazam {
    const genres = this.decode(row.genres, 'genres');
    const response = this.decode(row.rawSongResponse, 'rawSongResponse') as {
      SHMediaLibraryDataStoreRawResponseSongsData?: Uint8Array;
    } | null;
    const songData = response?.SHMediaLibraryDataStoreRawResponseSongsData;

    return {
      recognitionID: row.id,
      syncID: row.syncID ?? null,
      date: appleDate(row.date),
      title: row.title ?? null,
      subtitle: row.subtitle ?? null,
      shazamKey: row.shazamKey ?? null,
      shazamURL: row.shazamURL ?? null,
      providerName: row.providerName ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      artworkURL: row.artworkURL ?? null,
      appleMusicID: row.appleMusicID ?? null,
      appleMusicURL: row.appleMusicURL ?? null,
      isrc: row.isrc ?? null,
      albumName: row.albumName ?? null,
      releaseDate: row.releaseDate === null ? null : appleDate(row.releaseDate).slice(0, 10),
      explicit: row.explicit === null ? null : row.explicit === 1,
      genres: Array.isArray(genres) ? genres.filter(g => typeof g === 'string') : [],
      song: songData instanceof Uint8Array ? this.parseSong(songData) : null,
    };
  }

  // A blob that doesn't decode loses only that field, not the Shazam.
  private decode(blob: Uint8Array | null, field: string): unknown {
    if (!blob) return null;
    try {
      return unarchive(blob);
    } catch (error) {
      this.logger.warn(`Can't read a Shazam's ${field}: ${(error as Error).message}`);
      return null;
    }
  }

  private parseSong(data: Uint8Array): Shazam['song'] {
    try {
      return JSON.parse(Buffer.from(data).toString('utf8'));
    } catch (error) {
      this.logger.warn(`Can't read a Shazam's Apple Music song: ${(error as Error).message}`);
      return null;
    }
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      const { sql, values } = this.query('COUNT(*) AS n');
      return getRow<{ n: number }>(this.db.prepare(sql), ...values)?.n ?? null;
    } catch {
      return null;
    }
  }
}

function appleDate(seconds: number): string {
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}
