/**
 * Apple's public lookup API (the iTunes Search API's `lookup`), which needs
 * no sign-in. A song's lookup gives its main artist's ID beside the song's
 * whole credit line (`Artist & Guest`), so the artist's own name (`Artist`)
 * comes from looking up that ID.
 */
const LOOKUP_URL = 'https://itunes.apple.com/lookup';

// Apple answers for up to 200 IDs a request.
export const LOOKUP_BATCH = 200;

// Apple throttles the API with a 403 or 429; wait longer each time, then give up.
const BACKOFF_SECONDS = [10, 30, 60];

export interface AppleMusicArtist {
  id: string;
  name: string;
  url?: string;
}

/** A song to look up: its Apple Music ID and the store (`ca`, `us`) its link is in. */
export interface AppleMusicSong {
  id: string;
  country: string;
}

interface LookupResult {
  wrapperType?: string;
  trackId?: number;
  artistId?: number;
  artistName?: string;
  artistLinkUrl?: string;
}

interface LookupLog {
  info(message: string): void;
  /** Called once, when a lookup fails; the run stops looking up after it. */
  failure(error: Error): void;
}

export class AppleMusicLookup {
  // Remembered for the run, including what Apple had no answer for (null).
  private readonly artistOfSong = new Map<string, string | null>();
  private readonly artists = new Map<string, AppleMusicArtist | null>();
  private failed = false;
  private readonly log: LookupLog;

  constructor(log: LookupLog) {
    this.log = log;
  }

  /** Each song's main artist, by song ID. Songs Apple has no artist for are absent. */
  async artistsOf(songs: AppleMusicSong[]): Promise<Map<string, AppleMusicArtist>> {
    const newSongs = songs.filter(song => !this.artistOfSong.has(song.id));
    for (const [country, ids] of byCountry(newSongs)) {
      for (const result of await this.lookup(ids, country)) {
        if (result.wrapperType === 'track' && result.trackId && result.artistId) {
          this.artistOfSong.set(String(result.trackId), String(result.artistId));
        }
      }
      if (this.failed) return new Map();
      for (const id of ids) if (!this.artistOfSong.has(id)) this.artistOfSong.set(id, null);
    }

    const newArtists = songs
      .map(song => ({ id: this.artistOfSong.get(song.id), country: song.country }))
      .filter(
        (artist): artist is AppleMusicSong => Boolean(artist.id) && !this.artists.has(artist.id!)
      );
    for (const [country, ids] of byCountry(newArtists)) {
      for (const result of await this.lookup(ids, country)) {
        if (result.wrapperType === 'artist' && result.artistId && result.artistName) {
          this.artists.set(String(result.artistId), {
            id: String(result.artistId),
            name: result.artistName,
            ...(result.artistLinkUrl && { url: withoutQuery(result.artistLinkUrl) }),
          });
        }
      }
      if (this.failed) return new Map();
      for (const id of ids) if (!this.artists.has(id)) this.artists.set(id, null);
    }

    const found = new Map<string, AppleMusicArtist>();
    for (const song of songs) {
      const artist = this.artists.get(this.artistOfSong.get(song.id) ?? '');
      if (artist) found.set(song.id, artist);
    }
    return found;
  }

  private async lookup(ids: string[], country: string): Promise<LookupResult[]> {
    if (this.failed || ids.length === 0) return [];
    const url = `${LOOKUP_URL}?id=${ids.join(',')}&country=${encodeURIComponent(country)}`;
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url);
        if (response.ok)
          return ((await response.json()) as { results?: LookupResult[] }).results ?? [];
        const throttled = response.status === 403 || response.status === 429;
        if (!throttled || attempt >= BACKOFF_SECONDS.length) {
          throw new Error(`Apple Music's lookup answered ${response.status}`);
        }
        this.log.info(`Apple Music is limiting lookups; waiting ${BACKOFF_SECONDS[attempt]}s`);
        await sleep(BACKOFF_SECONDS[attempt] * 1000);
      }
    } catch (error) {
      this.failed = true;
      this.log.failure(error as Error);
      return [];
    }
  }
}

/** IDs grouped by store, in batches Apple answers for in one request. */
function byCountry(items: AppleMusicSong[]): Array<[string, string[]]> {
  const groups = new Map<string, Set<string>>();
  for (const { id, country } of items) {
    const ids = groups.get(country) ?? new Set<string>();
    ids.add(id);
    groups.set(country, ids);
  }
  const batches: Array<[string, string[]]> = [];
  for (const [country, ids] of groups) {
    const all = [...ids];
    for (let i = 0; i < all.length; i += LOOKUP_BATCH) {
      batches.push([country, all.slice(i, i + LOOKUP_BATCH)]);
    }
  }
  return batches;
}

/** The store an Apple Music link is in (`https://music.apple.com/ca/...`), or the US store. */
export function countryOf(link: string | null): string {
  return link?.match(/^https:\/\/music\.apple\.com\/([a-z]{2})\//)?.[1] ?? 'us';
}

function withoutQuery(link: string): string {
  return link.split('?')[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
