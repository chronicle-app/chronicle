import { AuthRequired, Record, htmlToText } from '@chronicle.app/etl';
import { getICloudAccount } from '@chronicle.app/apple';
import {
  SqliteExtractor,
  TimeRange,
  iterateRows,
  safariToUnixTimestamp,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import ApplePodcastsTransformer from './ApplePodcastsTransformer.js';

function getDefaultDbPath(): string {
  return path.join(
    os.homedir(),
    'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite'
  );
}

// An episode's row in the playback-sync table, which has when its playback
// position last synced.
const EPISODE_SYNC = 'LEFT JOIN ZMTUPPMETADATA u ON u.ZMETADATAIDENTIFIER = e.ZMETADATAIDENTIFIER';
// A show's channel is its publisher's page on Apple Podcasts. Shows published
// independently have none.
const SHOW_CHANNEL = 'LEFT JOIN ZMTCHANNEL c ON c.Z_PK = p.ZCHANNEL';

// When an episode was last listened to, as the transformer dates its listen:
// its last-played time, then when it was marked as played, then when its
// playback position last synced, and last when its play state changed.
const LISTENED_AT =
  'COALESCE(e.ZLASTDATEPLAYED, e.ZLASTUSERMARKEDASPLAYEDDATE, u.ZTIMESTAMP, e.ZPLAYSTATELASTMODIFIEDDATE)';

// When a saved episode was saved, as the transformer dates its bookmark.
const SAVED_AT = `COALESCE(e.ZLASTBOOKMARKEDDATE, ${LISTENED_AT})`;

// Episodes and shows are keyed by Apple's catalog ID, which is the same on each
// device. The library's own UUIDs differ from one device to the next, so what
// isn't in the catalog has no key and is left out.
const EPISODE_IN_CATALOG = 'IFNULL(e.ZSTORETRACKID, 0) > 0';
const SHOW_IN_CATALOG = 'IFNULL(ZSTORECOLLECTIONID, 0) > 0';

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Conditions that an Apple-epoch column is within since/until, both inclusive.
function inRange(column: string, range: TimeRange) {
  return timeRangeConditions(column, range, {
    convert: date => unixToSafariTimestamp(date.getTime() / 1000),
    sinceOp: '>=',
    untilOp: '<=',
  });
}

// Core Data timestamps are seconds since 2001-01-01, same epoch as Safari.
function toUnix(appleTimestamp: number | null | undefined): number | null {
  return appleTimestamp ? safariToUnixTimestamp(appleTimestamp) : null;
}

export class ApplePodcastsExtractor extends SqliteExtractor<typeof ApplePodcastsExtractor> {
  static override source = 'apple-podcasts';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  // Re-reads the live MTLibrary.sqlite play-state DB: each run re-reports the
  // same episode/show rows with their latest state. So state is sighted at read
  // time (the ListenAction's last-played time, a follow's standing) rather than
  // back-dated. Actions carrying a real historical date (listen, follow) keep
  // that date as their timeline position. See Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override description = 'Podcast listens and subscriptions';
  static override recordTypes = ['listens', 'subscriptions'];
  static override default = true;
  // Make `input` optional with the app's group-container path as the default, so
  // the CLI doesn't demand `--input` on a normal install. (Schema validation runs
  // before the constructor, so a constructor default wouldn't take effect.)
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .describe('Path to the Apple Podcasts MTLibrary.sqlite database')
      .default(() => getDefaultDbPath()),
    // The listener's Apple Account. Omitted, it's the account signed in to this
    // Mac. With none, extraction stops.
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
  }) as any;

  static override defaultTransformer = ApplePodcastsTransformer;

  // Transcripts that didn't read this run, for the run's summary.
  private unreadableTranscripts = 0;

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Every action is the listener's, so without their Apple Account there is
    // no one to attribute them to.
    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;
    if (!account) {
      throw new AuthRequired('Can’t find your Apple Account', {
        hint: 'Sign in to your Apple Account in System Settings, then run `chronicle extract apple-podcasts` again.',
      });
    }

    // The limit is on records of both types: the episodes' query takes it, and
    // the followed shows fill what's left.
    let count = 0;
    for await (const record of this.extractEpisodes(account)) {
      yield record;
      count++;
    }
    for await (const record of this.extractSubscriptions(account)) {
      if (this.shouldStopExtracting(count)) break;
      yield record;
      count++;
    }
    this.hintUncataloged();
  }

  // Say how many engaged episodes and followed shows were left out for not
  // being in Apple's catalog.
  private hintUncataloged(): void {
    const { where, values } = this.episodeFilter();
    const episodes = this.db!.prepare(
      `SELECT COUNT(*) AS n FROM ZMTEPISODE e ${EPISODE_SYNC}
       WHERE ${where} AND NOT ${EPISODE_IN_CATALOG}`
    ).get(...values) as { n: number };
    const shows = this.db!.prepare(
      `SELECT COUNT(*) AS n FROM ZMTPODCAST WHERE ZSUBSCRIBED = 1 AND NOT ${SHOW_IN_CATALOG}`
    ).get() as { n: number };
    const total = episodes.n + shows.n;
    if (total === 0) return;
    const parts = [
      episodes.n > 0 && counted(episodes.n, 'episode', 'episodes'),
      shows.n > 0 && counted(shows.n, 'followed show', 'followed shows'),
    ].filter(Boolean);
    this.hint(
      `${parts.join(' and ')} ${total === 1 ? 'was' : 'were'} left out, as ${total === 1 ? 'it isn’t' : 'they aren’t'} in Apple’s catalog`,
      {
        action:
          'Only what’s in Apple’s catalog has an ID that’s the same on each device. Report it if you need them, so they can be keyed another way.',
      }
    );
  }

  // Episodes the user actually engaged with: played (a non-zero play count or a
  // playhead past the first few seconds) or bookmarked. Within since/until, an
  // episode is extracted when its listen or its bookmark is in the range, by
  // the dates the transformer gives them. Queried with EPISODE_SYNC.
  private episodeFilter(): { where: string; values: Array<number | string> } {
    const listened = inRange(LISTENED_AT, this.config);
    const saved = inRange(SAVED_AT, this.config);
    const played = ['(e.ZPLAYCOUNT > 0 OR e.ZPLAYHEAD > 10)', ...listened.conditions];
    const bookmarked = ['e.ZISBOOKMARKED = 1', ...saved.conditions];
    return {
      where: `((${played.join(' AND ')}) OR (${bookmarked.join(' AND ')}))`,
      values: [...listened.values, ...saved.values],
    };
  }

  // Each engaged episode becomes a ListenAction / CompleteAction /
  // BookmarkAction.
  private async *extractEpisodes(account: unknown): AsyncGenerator<Record> {
    const limit = this.getEffectiveLimit();
    const { where, values } = this.episodeFilter();

    // The episode's duration and audio file are on its current media enclosure,
    // and its description is a row of its own. Newest listen first.
    let sql = `
      SELECT e.ZGUID AS episodeGuid,
             e.ZTITLE AS episodeTitle,
             e.ZAUTHOR AS episodeAuthor,
             m.ZDURATION AS duration,
             e.ZPLAYHEAD AS playhead,
             e.ZPLAYCOUNT AS playCount,
             e.ZPLAYSTATELASTMODIFIEDDATE AS stateModified,
             e.ZLASTDATEPLAYED AS lastDatePlayed,
             e.ZLASTUSERMARKEDASPLAYEDDATE AS userMarkedPlayedDate,
             u.ZTIMESTAMP AS playbackSyncedDate,
             e.ZISBOOKMARKED AS isBookmarked,
             e.ZLASTBOOKMARKEDDATE AS lastBookmarkedDate,
             e.ZPUBDATE AS publishDate,
             e.ZSTORETRACKID AS storeTrackId,
             m.ZREMOTEURL AS audioUrl,
             m.ZTRANSCRIPTIDENTIFIER AS transcriptIdentifier,
             e.ZWEBPAGEURL AS webUrl,
             e.ZARTWORKTEMPLATEURL AS artworkUrl,
             d.ZTEXT AS episodeDescription,
             p.ZTITLE AS podcastTitle,
             p.ZAUTHOR AS podcastAuthor,
             p.ZCATEGORY AS podcastCategory,
             p.ZFEEDURL AS feedUrl,
             p.ZUPDATEDFEEDURL AS updatedFeedUrl,
             p.ZIMAGEURL AS imageUrl,
             p.ZSTORECOLLECTIONID AS storeCollectionId,
             p.ZWEBPAGEURL AS podcastWebUrl,
             p.ZITEMDESCRIPTION AS podcastDescription,
             c.ZSTOREID AS channelStoreId,
             c.ZNAME AS channelName
      FROM ZMTEPISODE e
      LEFT JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
      ${SHOW_CHANNEL}
      LEFT JOIN ZMTMEDIAENCLOSURE m ON m.Z_PK = e.ZCURRENTMEDIAENCLOSURE
      LEFT JOIN ZMTEPISODEDESCRIPTION d ON d.Z_PK = e.ZDESCRIPTIONOBJECT
      ${EPISODE_SYNC}
      WHERE ${where} AND ${EPISODE_IN_CATALOG}
      ORDER BY ${LISTENED_AT} DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      values.push(limit);
    }

    // Apple Podcasts keeps the transcripts it has downloaded in its group
    // container, beside the library's folder, named by the transcript's
    // identifier and the episode's catalog ID.
    const transcripts = path.resolve(
      path.dirname(path.resolve(this.config.input)),
      '../Library/Cache/Assets/TTML'
    );
    this.unreadableTranscripts = 0;
    for (const row of iterateRows<any>(this.db!.prepare(sql), ...values)) {
      const transcript = this.readTranscript(transcripts, row);
      yield this.createRecord(
        { ...this.processEpisode(row), transcript },
        { recordType: 'listens', account }
      );
    }
    this.hintUnreadableTranscripts();
  }

  // The episode's transcript as text, when Apple Podcasts has downloaded it: a
  // paragraph for each speaker's turn, starting with the speaker's label, such
  // as `SPEAKER_1: `, and without timings. A transcript that doesn't read loses
  // only the transcript, not the episode.
  private readTranscript(folder: string, row: any): string | null {
    const { transcriptIdentifier: identifier, storeTrackId } = row;
    if (typeof identifier !== 'string' || typeof storeTrackId !== 'number') return null;
    const file = path.resolve(folder, `${identifier}-${storeTrackId}.ttml`);
    if (!file.startsWith(folder + path.sep)) return null;
    try {
      // Each word of the TTML is a span, with no space between the spans. Each
      // turn is a `<p>` with its speaker's label in `ttm:agent`.
      const ttml = readFileSync(file, 'utf8')
        .replaceAll('</span><span', '</span> <span')
        .replaceAll(/<p\b[^>]*\bttm:agent="([^"]+)"[^>]*>/g, '$&$1: ');
      return htmlToText(ttml) || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      this.logger.warn(`Can't read an episode's transcript: ${(error as Error).message}`);
      this.unreadableTranscripts++;
      return null;
    }
  }

  private hintUnreadableTranscripts(): void {
    const count = this.unreadableTranscripts;
    if (count === 0) return;
    const episodes =
      count === 1
        ? '1 transcript couldn’t be read, so its episode has'
        : `${count} transcripts couldn’t be read, so their episodes have`;
    this.hint(`${episodes} none`, {
      action:
        'Check that Chronicle can read the Podcasts folder in ~/Library/Group Containers, then run `chronicle extract apple-podcasts` again.',
    });
  }

  // Shows the user explicitly subscribed to — each becomes a FollowAction dated
  // when it was added to the library.
  private async *extractSubscriptions(account: unknown): AsyncGenerator<Record> {
    const rows = this.db!.prepare(
      `SELECT p.ZTITLE AS podcastTitle,
              p.ZAUTHOR AS podcastAuthor,
              p.ZCATEGORY AS podcastCategory,
              p.ZFEEDURL AS feedUrl,
              p.ZUPDATEDFEEDURL AS updatedFeedUrl,
              p.ZIMAGEURL AS imageUrl,
              p.ZWEBPAGEURL AS podcastWebUrl,
              p.ZSTORECOLLECTIONID AS storeCollectionId,
              p.ZADDEDDATE AS addedDate,
              p.ZITEMDESCRIPTION AS podcastDescription,
              c.ZSTOREID AS channelStoreId,
              c.ZNAME AS channelName
       FROM ZMTPODCAST p
       ${SHOW_CHANNEL}
       WHERE p.ZSUBSCRIBED = 1 AND ${SHOW_IN_CATALOG}`
    ).all() as any[];

    for (const row of rows) {
      yield this.createRecord(
        { ...row, addedDate: toUnix(row.addedDate) },
        { recordType: 'subscriptions', account }
      );
    }
  }

  private processEpisode(row: any): any {
    return {
      ...row,
      stateModified: toUnix(row.stateModified),
      lastDatePlayed: toUnix(row.lastDatePlayed),
      userMarkedPlayedDate: toUnix(row.userMarkedPlayedDate),
      playbackSyncedDate: toUnix(row.playbackSyncedDate),
      lastBookmarkedDate: toUnix(row.lastBookmarkedDate),
      publishDate: toUnix(row.publishDate),
      duration: row.duration || 0,
      playhead: row.playhead || 0,
      playCount: row.playCount || 0,
      isBookmarked: row.isBookmarked === 1,
    };
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;

    try {
      const { where, values } = this.episodeFilter();
      const episodes = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ZMTEPISODE e ${EPISODE_SYNC}
           WHERE ${where} AND ${EPISODE_IN_CATALOG}`
        )
        .get(...values) as { n: number };
      const subscriptions = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ZMTPODCAST WHERE ZSUBSCRIBED = 1 AND ${SHOW_IN_CATALOG}`
        )
        .get() as { n: number };
      return episodes.n + subscriptions.n;
    } catch {
      return null;
    }
  }
}
