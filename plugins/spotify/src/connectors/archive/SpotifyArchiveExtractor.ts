import { basename } from 'node:path';
import {
  countMonth,
  Extractor,
  InputNotFound,
  openExport,
  type ExportFiles,
  type KindSurvey,
  type Record,
  type SurveyOptions,
} from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';
import { z } from 'zod';
import SpotifyProxy from '../../utils/SpotifyProxy.js';
import { idOf } from '../../utils/uris.js';
import { text } from './fields.js';
import SpotifyArchiveTransformer from './SpotifyArchiveTransformer.js';
import type { SpotifyAccount, SpotifyApiArtist, SpotifyApiTrack } from './types.js';

/**
 * The files of Spotify's data download that a run reads, by name. Spotify
 * sends each part of a download as its own zip: the account data, with the
 * library, playlists, and searches, in a `Spotify Account Data` folder, and
 * the extended streaming history, every stream since the account began, in
 * `Spotify Extended Streaming History`. Files are found by name wherever they
 * are, so a run takes either zip, its folder, or a folder that holds both.
 */
export const FILES = {
  /** The extended streaming history. Older downloads name it endsong_N.json, with the same fields. */
  streams: /^(?:Streaming_History_Audio_.+|endsong_\d+)\.json$/,
  library: /^YourLibrary\.json$/,
  playlists: /^Playlist\d+\.json$/,
  searches: /^SearchQueries\.json$/,
  user: /^Userdata\.json$/,
  identity: /^Identity\.json$/,
};

/** As many tracks as the Spotify API looks up in one request. */
const TRACKS_PER_REQUEST = 50;

/** An API artist, cut to what becomes its node. */
function apiArtist({ id, name, external_urls }: SpotifyApiArtist): SpotifyApiArtist {
  return { id, name, ...(external_urls && { external_urls }) };
}

/** An API track, cut to what becomes nodes, without the market lists that dwarf it. */
function apiTrack(track: any): SpotifyApiTrack {
  const { album } = track;
  return {
    id: track.id,
    name: track.name,
    duration_ms: track.duration_ms,
    ...(track.preview_url && { preview_url: track.preview_url }),
    external_urls: track.external_urls,
    artists: (track.artists ?? []).map((artist: SpotifyApiArtist) => apiArtist(artist)),
    album: {
      id: album.id,
      name: album.name,
      ...(album.release_date && { release_date: album.release_date }),
      ...(album.images && { images: album.images }),
      ...(album.external_urls && { external_urls: album.external_urls }),
      ...(album.artists && {
        artists: album.artists.map((artist: SpotifyApiArtist) => apiArtist(artist)),
      }),
    },
  };
}

/**
 * Base for the kinds of Spotify's data download: the zips its Privacy page
 * sends, read as zips or unpacked. Shared here: finding the download's files,
 * whose download it is, and when Spotify wrote it. One subclass per file it
 * reads, so a run that asks for searches doesn't read years of streams.
 */
export abstract class SpotifyArchiveExtractor<
  T extends typeof SpotifyArchiveExtractor = typeof SpotifyArchiveExtractor,
> extends Extractor<T> {
  static override source = 'spotify';
  static override delivery = 'export' as const;
  static override strategy = 'archive';
  static override defaultTransformer = SpotifyArchiveTransformer;

  // `input` is checked in setup() rather than by the schema: a source's flags
  // are shared, so a schema-required flag here would also gate the API.
  static override schema = Extractor.schema.extend({
    input: z.string().optional().describe('Your Spotify data download, as a zip or its folder'),
    lookup: z
      .boolean()
      .optional()
      .describe(
        "Look up each downloaded track's artists and album from the Spotify API (default: when signed in)"
      ),
    accessToken: z
      .string()
      .optional()
      .describe(
        'OAuth access token for Spotify API authentication (auto-retrieved if not provided)'
      ),
  });

  /** The files this kind reads, from {@link FILES}. */
  protected abstract readonly reads: RegExp;

  /** Whose download this is, attached to every record. */
  protected account: SpotifyAccount = {};

  private files: ExportFiles | null = null;
  /** Every file in the download, by its path in it. */
  private paths: string[] = [];
  /** When Spotify wrote the files this kind reads; see {@link asOfTime}. */
  private writtenAt?: Date;
  /** Where tracks are looked up, once a run asks: null when it doesn't look them up. */
  private api?: SpotifyProxy | null;
  /** The tracks looked up this run, by ID: null for one Spotify doesn't know. */
  private readonly tracks = new Map<string, SpotifyApiTrack | null>();

  override async setup(): Promise<void> {
    await super.setup();
    const { input } = this.config as { input?: string };
    if (!input) {
      throw new InputNotFound('No Spotify data download given', {
        hint: 'Pass the zip Spotify sent, or its folder, with `--input <path>`.',
      });
    }
    this.files = await openExport(input, 'Spotify data download');
    this.paths = await this.files.list();
    const names = Object.values(FILES);
    if (!this.paths.some(path => names.some(name => name.test(basename(path))))) {
      await this.teardown();
      throw new InputNotFound('No Spotify data in the download', {
        path: input,
        hint: 'Pass the zip with your account data or extended streaming history, or its folder, with `--input <path>`.',
      });
    }
    this.writtenAt = await this.newestTime(this.pathsOf(this.reads));
    this.account = await this.loadAccount();
  }

  override async teardown(): Promise<void> {
    await this.files?.close();
    this.files = null;
    await super.teardown();
  }

  /**
   * The "as of" time for what a kind reads without a time of its own, like a
   * liked song: when Spotify wrote its file, taken as the file's modified
   * time, or in a zip, the time its index gives it. A download is a frozen
   * artifact, so this also makes a second import of it a no-op.
   */
  protected override asOfTime(): Date {
    return this.writtenAt ?? super.asOfTime();
  }

  /** The paths of the files a name matches, in the download's order. */
  protected pathsOf(name: RegExp): string[] {
    return this.paths.filter(path => name.test(basename(path)));
  }

  /** One JSON file from the download, by its path in it. */
  protected async readJson(path: string): Promise<any> {
    return this.files!.readJson(path);
  }

  /** Whether a time falls inside the run's since/until window. */
  protected inRange(time: Date): boolean {
    const { since, until } = this.config;
    if (since && time < since) return false;
    if (until && time > until) return false;
    return true;
  }

  /**
   * A record of the download, with whose it is. `occurredAt` is when its
   * occurrence happened. With `asOfDownload`, what it says is observed when
   * Spotify wrote the download rather than when it happened, as for a record
   * with no time of its own, or only a date.
   */
  protected record(
    recordType: string,
    data: unknown,
    { occurredAt, asOfDownload = false }: { occurredAt?: Date; asOfDownload?: boolean } = {}
  ): Record {
    return this.createRecord(
      data,
      {
        recordType,
        account: this.account,
        ...(occurredAt && { occurredAt: occurredAt.toISOString() }),
      },
      asOfDownload ? { assertedAt: this.asOfTime() } : {}
    );
  }

  /**
   * `items`, each with its track as the Spotify API gives it, so the track's
   * artists and album have the IDs the download leaves out. Tracks are looked
   * up 50 at a time as new ones turn up, and each only once a run. Without a
   * lookup, turned off or not signed in, each item comes with none.
   */
  protected async *withTracks<I>(
    items: AsyncIterable<I> | Iterable<I>,
    uriOf: (item: I) => unknown
  ): AsyncGenerator<[I, SpotifyApiTrack | undefined]> {
    await this.startLookup();
    let held: I[] = [];
    const wanted = new Set<string>();
    for await (const item of items) {
      held.push(item);
      const id = idOf(uriOf(item), 'track');
      if (this.api && id && !this.tracks.has(id)) wanted.add(id);
      if (this.api && wanted.size < TRACKS_PER_REQUEST) continue;
      await this.lookUp(wanted);
      for (const each of held) yield [each, this.trackOf(uriOf(each))];
      held = [];
    }
    await this.lookUp(wanted);
    for (const each of held) yield [each, this.trackOf(uriOf(each))];
    const found = [...this.tracks.values()].filter(Boolean).length;
    if (found > 0) this.logger.info(`Looked up ${found} tracks from the Spotify API`);
  }

  /** How many records a run reads and when, from the time it dates each by. */
  protected surveyOf(times: Date[], options: SurveyOptions): KindSurvey {
    const kind: KindSurvey = { count: times.length, ...(options.byMonth && { byMonth: {} }) };
    for (const time of times) {
      if (!kind.earliest || time < kind.earliest) kind.earliest = time;
      if (!kind.latest || time > kind.latest) kind.latest = time;
      if (kind.byMonth) countMonth(kind.byMonth, time);
    }
    return kind;
  }

  /**
   * Whether a run looks tracks up: not when it's turned off, and by default
   * only when signed in to Spotify. Asked for outright without credentials,
   * the run fails with how to sign in.
   */
  private async startLookup(): Promise<void> {
    if (this.api !== undefined) return;
    this.api = null;
    const { lookup, accessToken } = this.config as { lookup?: boolean; accessToken?: string };
    if (lookup === false) return;
    const token =
      accessToken ??
      (lookup
        ? await TokenHelper.getValidToken('spotify')
        : await TokenHelper.getValidToken('spotify').catch(() => null));
    if (token) {
      this.api = new SpotifyProxy(token);
      this.logger.emit({
        level: 'info',
        kind: 'notice',
        message: 'Looking up tracks in the Spotify API for their artists’ and albums’ IDs',
        hint: { action: 'Pass `--no-lookup` to read the files alone.' },
      });
      return;
    }
    this.hint('Artists and albums are by name, not Spotify ID', {
      action:
        'Run `chronicle auth login spotify --client-id <id> --client-secret <secret>` to look them up from the Spotify API, or pass `--no-lookup` to skip this.',
    });
  }

  /** Looks up the tracks `ids` names, then clears it. A failure stops the run's lookups. */
  private async lookUp(ids: Set<string>): Promise<void> {
    if (this.api && ids.size > 0) {
      const asked = [...ids];
      try {
        const found = await this.api.getTracks(asked);
        for (const [i, id] of asked.entries()) {
          this.tracks.set(id, found[i] ? apiTrack(found[i]) : null);
        }
      } catch (error) {
        this.api = null;
        this.logger.warn(
          `Stopped looking up tracks from the Spotify API, so the rest have artists and albums by name: ${(error as Error).message}`
        );
      }
    }
    ids.clear();
  }

  /** The looked-up track a URI names, if a run has it. */
  private trackOf(uri: unknown): SpotifyApiTrack | undefined {
    const id = idOf(uri, 'track');
    return (id && this.tracks.get(id)) || undefined;
  }

  /**
   * Whose download this is, from the account data's Userdata.json and
   * Identity.json. Older streaming histories name the account on each stream;
   * newer ones don't.
   */
  private async loadAccount(): Promise<SpotifyAccount> {
    const [user] = this.pathsOf(FILES.user);
    const [identity] = this.pathsOf(FILES.identity);
    const username = user && text((await this.readJson(user))?.username);
    const displayName = identity && text((await this.readJson(identity))?.displayName);
    return { ...(username && { username }), ...(displayName && { displayName }) };
  }

  /** The newest modified time among files in the download, or none if none has one. */
  private async newestTime(paths: string[]): Promise<Date | undefined> {
    let newest: number | undefined;
    for (const path of paths) {
      const modified = (await this.files!.modified(path))?.getTime();
      if (modified !== undefined && (newest === undefined || modified > newest)) newest = modified;
    }
    return newest === undefined ? undefined : new Date(newest);
  }
}
