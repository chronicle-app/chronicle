import { Extractor, InputNotFound, Record, openExport, type ExportFiles } from '@chronicle.app/etl';
import { z } from 'zod';
import { parseTakeoutCsv } from '../takeout/csv.js';
import { parseActivityHtml, videoIdFromUrl } from '../takeout/parseActivityHtml.js';
import YouTubeTakeoutTransformer from './YouTubeTakeoutTransformer.js';

export interface TakeoutSelfChannel {
  id: string;
  title?: string;
}

export interface TakeoutWatchRecord {
  videoId: string;
  title?: string;
  titleUrl?: string;
  channelId?: string;
  channelName?: string;
  time: string;
}

export interface TakeoutSearchRecord {
  query: string;
  time: string;
}

export interface TakeoutSubscriptionRecord {
  channelId: string;
  channelTitle?: string;
}

export interface TakeoutPlaylistRecord {
  playlistId: string;
  title: string;
  createdAt: string;
  visibility?: string;
}

export interface TakeoutPlaylistItemRecord {
  playlistId: string;
  playlistTitle: string;
  videoId: string;
  addedAt: string;
}

export interface TakeoutUploadRecord {
  videoId: string;
  title?: string;
  description?: string;
  durationMs?: string;
  publishedAt: string;
}

export interface TakeoutCommentRecord {
  commentId: string;
  videoId: string;
  rawText: string;
  createdAt: string;
}

// The folder Takeout puts YouTube's files in.
const PRODUCT = 'YouTube and YouTube Music';

// Where that folder can be in an export: the export itself, as an unpacked
// folder was passed before, in the Takeout folder, or in the zip that holds it.
const PREFIXES = ['', `${PRODUCT}/`, `Takeout/${PRODUCT}/`];

// Relative paths of the archive files this extractor reads.
const FILES = {
  watch: 'history/watch-history.html',
  search: 'history/search-history.html',
  subscriptions: 'subscriptions/subscriptions.csv',
  playlists: 'playlists/playlists.csv',
  uploads: 'video metadata/videos.csv',
  comments: 'comments/comments.csv',
  channel: 'channels/channel.csv',
} as const;

export class YouTubeTakeoutExtractor extends Extractor<typeof YouTubeTakeoutExtractor> {
  static override source = 'youtube';
  static override description = 'Watch and search history and library from Takeout';

  static override delivery = 'export' as const;
  static override strategy = 'takeout';
  static override recordTypes = [
    'watches',
    'searches',
    'subscriptions',
    'playlists',
    'playlist-items',
    'uploads',
    'comments',
  ];

  static override default = false;
  // A Takeout archive is a full re-read of account state: re-exporting
  // re-reports the same rows with their latest values (current titles,
  // current membership), so attributes are sighted at export time while
  // actions keep their own occurrence timestamps.
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = YouTubeTakeoutTransformer;

  // `input` is validated in setup() rather than by the schema: the CLI unions
  // flags across a source's extractors, so a schema-required flag here would
  // also gate the API extractors that share the youtube source.
  static override schema = Extractor.schema.extend({
    input: z
      .string()
      .optional()
      .describe(`The Takeout, as a folder or zip, or its "${PRODUCT}" folder`),
  });

  private files: ExportFiles | null = null;
  /** Where the YouTube folder is in the export, as a path prefix. */
  private prefix = '';
  private archiveAsOf: Date | null = null;
  private selfChannel: TakeoutSelfChannel | null = null;

  /** The path in the export of a file in the YouTube folder. */
  private inputPath(relative: string): string {
    return this.prefix + relative;
  }

  private async fileExists(path: string): Promise<boolean> {
    return this.files!.has(path);
  }

  private async readCsv(path: string): Promise<{ [column: string]: string }[]> {
    return parseTakeoutCsv(await this.files!.readText(path));
  }

  override async setup(): Promise<void> {
    await super.setup();
    const config = this.config as z.infer<typeof YouTubeTakeoutExtractor.schema>;
    if (!config.input) {
      throw new Error(
        `The takeout extractor needs --input: the Takeout, as a folder or zip, or its "${PRODUCT}" folder`
      );
    }
    this.files = await openExport(config.input);
    const listed = new Set(await this.files.list());
    const prefix = PREFIXES.find(p => Object.values(FILES).some(f => listed.has(p + f)));
    if (prefix === undefined) {
      await this.teardown();
      throw new InputNotFound(`No ${PRODUCT} folder in the export`, {
        path: config.input,
        hint: `Pass the Takeout, as a folder or zip, or its "${PRODUCT}" folder with \`--input <path>\`.`,
      });
    }
    this.prefix = prefix;

    // The archive is a static artifact: its sighting time is the export's,
    // not this run's, so re-running over an unchanged tree is a byte-identical
    // no-op. Newest mtime across the files read stands in for the export time;
    // in a zip, the time its index gives each file.
    const paths = [
      ...Object.values(FILES).map(f => this.inputPath(f)),
      ...(await this.playlistItemFiles()).map(([, path]) => path),
    ];
    let newest = 0;
    for (const path of paths) {
      // Missing sections are fine; each is skipped with a warning later.
      const modified = await this.files.modified(path);
      if (modified) newest = Math.max(newest, modified.getTime());
    }
    if (newest > 0) this.archiveAsOf = new Date(newest);

    const channelPath = this.inputPath(FILES.channel);
    if (await this.fileExists(channelPath)) {
      const [row] = await this.readCsv(channelPath);
      const id = row?.['Channel ID'];
      if (id) {
        this.selfChannel = {
          id,
          title: row['Channel Title (Original)'] || undefined,
        };
      }
    }
    if (!this.selfChannel) {
      this.logger.warn(
        'channels/channel.csv missing or empty — the account owner falls back to the per-source singleton self'
      );
    }
  }

  override async teardown(): Promise<void> {
    await this.files?.close();
    this.files = null;
    await super.teardown();
  }

  protected override asOfTime(): Date {
    return this.archiveAsOf ?? super.asOfTime();
  }

  private inRange(time: Date): boolean {
    const { since, until } = this.config;
    if (since && time < since) return false;
    if (until && time > until) return false;
    return true;
  }

  /** `[playlist title, csv path]` for each per-playlist membership file. */
  private async playlistItemFiles(): Promise<[string, string][]> {
    const dir = this.inputPath('playlists/');
    return (await this.files!.list(dir))
      .map(path => path.slice(dir.length))
      .filter(name => !name.includes('/') && name.endsWith('-videos.csv'))
      .map(name => [name.slice(0, -'-videos.csv'.length), dir + name]);
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    const self = this.selfChannel;
    const emit = (recordType: string, data: unknown): Record =>
      this.createRecord(data, { recordType, selfChannel: self });

    for (const section of [
      this.extractWatches(),
      this.extractSearches(),
      this.extractSubscriptions(),
      this.extractPlaylists(),
      this.extractUploads(),
      this.extractComments(),
    ]) {
      for await (const [recordType, data] of section) {
        if (this.shouldStopExtracting(count)) return;
        yield emit(recordType, data);
        count++;
      }
    }
  }

  private async *extractWatches(): AsyncGenerator<[string, unknown]> {
    const path = this.inputPath(FILES.watch);
    if (!(await this.fileExists(path))) {
      this.logger.warn(`No watch history at ${FILES.watch} — skipping`);
      return;
    }

    const entries = parseActivityHtml(await this.files!.readText(path));
    let ads = 0;
    let noise = 0;
    let unparseable = 0;
    let emitted = 0;

    for (const entry of entries) {
      if (entry.isAd) {
        ads++;
        continue;
      }
      // "Visited" (ad clicks) and "Used Shorts creation tools" aren't watches.
      if (entry.verb !== 'Watched') {
        noise++;
        continue;
      }
      const videoId = entry.titleHref && videoIdFromUrl(entry.titleHref);
      if (!videoId) {
        unparseable++;
        continue;
      }
      if (!this.inRange(entry.time)) continue;

      const record: TakeoutWatchRecord = {
        videoId,
        title: entry.titleText,
        titleUrl: entry.titleHref,
        channelId: entry.channelId,
        channelName: entry.channelName,
        time: entry.time.toISOString(),
      };
      yield ['watches', record];
      emitted++;
    }

    this.logger.info(
      `Watch history: ${emitted} watches (skipped ${ads} ads, ${noise} non-watch entries, ${unparseable} without a video id)`
    );
  }

  private async *extractSearches(): AsyncGenerator<[string, unknown]> {
    const path = this.inputPath(FILES.search);
    if (!(await this.fileExists(path))) {
      this.logger.warn(`No search history at ${FILES.search} — skipping`);
      return;
    }

    const entries = parseActivityHtml(await this.files!.readText(path));
    let skipped = 0;
    let emitted = 0;

    for (const entry of entries) {
      // The search file also carries ad-impression "Watched" rows and ad-click
      // "Visited" rows; only real searches are activity.
      if (entry.isAd || entry.verb !== 'Searched for' || !entry.titleText) {
        skipped++;
        continue;
      }
      if (!this.inRange(entry.time)) continue;

      const record: TakeoutSearchRecord = {
        query: entry.titleText,
        time: entry.time.toISOString(),
      };
      yield ['searches', record];
      emitted++;
    }

    this.logger.info(
      `Search history: ${emitted} searches (skipped ${skipped} ads/non-search entries)`
    );
  }

  private async *extractSubscriptions(): AsyncGenerator<[string, unknown]> {
    const path = this.inputPath(FILES.subscriptions);
    if (!(await this.fileExists(path))) return;

    for (const row of await this.readCsv(path)) {
      const channelId = row['Channel Id'];
      if (!channelId) continue;
      const record: TakeoutSubscriptionRecord = {
        channelId,
        channelTitle: row['Channel Title'] || undefined,
      };
      yield ['subscriptions', record];
    }
  }

  private async *extractPlaylists(): AsyncGenerator<[string, unknown]> {
    const path = this.inputPath(FILES.playlists);
    if (!(await this.fileExists(path))) return;

    const byTitle = new Map<string, TakeoutPlaylistRecord>();
    for (const row of await this.readCsv(path)) {
      const playlistId = row['Playlist ID'];
      const createdAt = row['Playlist Create Timestamp'];
      if (!playlistId || !createdAt) continue;
      const record: TakeoutPlaylistRecord = {
        playlistId,
        title: row['Playlist Title (Original)'] ?? '',
        createdAt,
        visibility: row['Playlist Visibility'] || undefined,
      };
      byTitle.set(record.title, record);
      yield ['playlists', record];
    }

    // Membership files are named after the playlist title; a file whose title
    // no longer matches playlists.csv has no playlist id to key against.
    for (const [title, itemPath] of await this.playlistItemFiles()) {
      const playlist = byTitle.get(title);
      if (!playlist) {
        this.logger.warn(
          `Playlist file "${itemPath.split('/').at(-1)}" has no matching row in playlists.csv — skipping`
        );
        continue;
      }
      for (const row of await this.readCsv(itemPath)) {
        const videoId = row['Video ID'];
        const addedAt = row['Playlist Video Creation Timestamp'];
        if (!videoId || !addedAt) continue;
        const record: TakeoutPlaylistItemRecord = {
          playlistId: playlist.playlistId,
          playlistTitle: playlist.title,
          videoId,
          addedAt,
        };
        yield ['playlist-items', record];
      }
    }
  }

  private async *extractUploads(): AsyncGenerator<[string, unknown]> {
    const path = this.inputPath(FILES.uploads);
    if (!(await this.fileExists(path))) return;

    let drafts = 0;
    for (const row of await this.readCsv(path)) {
      const videoId = row['Video ID'];
      if (!videoId) continue;
      // A row without a publish timestamp is an unpublished draft/private
      // upload — there is no publication occurrence to assert.
      const publishedAt = row['Video Publish Timestamp'];
      if (!publishedAt) {
        drafts++;
        continue;
      }
      const record: TakeoutUploadRecord = {
        videoId,
        title: row['Video Title (Original)'] || undefined,
        description: row['Video Description (Original)'] || undefined,
        durationMs: row['Approx Duration (ms)'] || undefined,
        publishedAt,
      };
      yield ['uploads', record];
    }
    if (drafts > 0) {
      this.logger.info(`Uploads: skipped ${drafts} unpublished draft(s)`);
    }
  }

  private async *extractComments(): AsyncGenerator<[string, unknown]> {
    const path = this.inputPath(FILES.comments);
    if (!(await this.fileExists(path))) return;

    for (const row of await this.readCsv(path)) {
      const commentId = row['Comment ID'];
      const videoId = row['Video ID'];
      const createdAt = row['Comment Create Timestamp'];
      if (!commentId || !videoId || !createdAt) continue;
      const record: TakeoutCommentRecord = {
        commentId,
        videoId,
        rawText: row['Comment Text'] ?? '',
        createdAt,
      };
      yield ['comments', record];
    }
  }
}
