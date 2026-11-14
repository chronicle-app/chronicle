import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** What a film's page on Letterboxd says about it that the export doesn't. */
export interface FilmPage {
  /** The film's slug, as in `https://letterboxd.com/film/<slug>/`. */
  slug: string;
  /** The film's IMDb id, such as `tt0122718`. */
  imdb?: string;
  /** The film's TMDB id with its kind, such as `movie/11551` or `tv/1396`. */
  tmdb?: string;
}

const FILM_URL = /^https:\/\/letterboxd\.com\/film\/([^/]+)\/?$/;
const ENTRY_URL = /^https:\/\/letterboxd\.com\/[^/]+\/film\/([^/]+)\//;

/** Where fetched pages are kept when no `film-cache` is given. */
export function defaultCachePath(): string {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(cache, 'chronicle', 'letterboxd', 'films.json');
}

/** The film's code in a `https://boxd.it/<code>` link, or none. */
export function codeOf(link: string | undefined): string | undefined {
  return /^https?:\/\/boxd\.it\/([A-Za-z0-9]+)\/?$/.exec(link?.trim() ?? '')?.[1];
}

/** The page's facts, read from where it ended up and its HTML. */
export function parseFilmPage(url: string, html: string): FilmPage | undefined {
  const slug = FILM_URL.exec(url)?.[1];
  if (!slug) return undefined;
  const imdb = /imdb\.com\/title\/(tt\d+)/.exec(html)?.[1];
  const tmdb = /themoviedb\.org\/(movie|tv)\/(\d+)/.exec(html);
  return { slug, ...(imdb && { imdb }), ...(tmdb && { tmdb: `${tmdb[1]}/${tmdb[2]}` }) };
}

/**
 * The pages of the films in an export, by film code. Pages already fetched are
 * kept in a file and read on every run, so a film keeps what its page said
 * whether or not this run fetches. Only a run with fetching on asks Letterboxd
 * for one, a page at a time.
 */
export class FilmPages {
  private pages: { [code: string]: FilmPage } = {};
  private unsaved = 0;
  private lastRequest = 0;
  /** Set when Letterboxd turned a request away, so the run stops asking. */
  private refused = false;
  private fetched = 0;
  private failed = 0;
  private reported = false;
  private unread = new Set<string>();

  constructor(
    private readonly path: string,
    private readonly fetching: boolean,
    /** The pause between two requests, in milliseconds. */
    private readonly pause = 250
  ) {}

  async load(): Promise<void> {
    try {
      this.pages = JSON.parse(await readFile(this.path, 'utf8'));
    } catch {
      this.pages = {};
    }
  }

  async save(): Promise<void> {
    if (this.unsaved === 0) return;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(this.pages, null, 1)}\n`);
    this.unsaved = 0;
  }

  /** How many films in `codes` have no page yet. */
  missing(codes: Iterable<string>): number {
    let count = 0;
    for (const code of codes) if (!this.pages[code]) count++;
    return count;
  }

  /** The film's page: the one kept, or fetched now when fetching is on. */
  async of(code: string): Promise<FilmPage | undefined> {
    const kept = this.pages[code];
    if (kept || !this.fetching || this.refused || this.unread.has(code)) return kept;
    const response = await this.get(`https://boxd.it/${code}`);
    const page = response && parseFilmPage(response.url, response.html);
    if (!page) {
      // Asked once a run: every record of the film would ask again.
      if (!this.refused) this.unread.add(code);
      this.failed++;
      return undefined;
    }
    await this.keep(code, page);
    return page;
  }

  /**
   * The code of the film a diary entry is of, by following the entry's link
   * to its film's page. None when fetching is off or the page can't be read.
   */
  async filmOfEntry(entry: string): Promise<string | undefined> {
    if (!this.fetching || this.refused) return undefined;
    const viewing = await this.get(`https://boxd.it/${entry}`);
    const slug = viewing && ENTRY_URL.exec(viewing.url)?.[1];
    if (!slug) return undefined;
    const known = Object.entries(this.pages).find(([, page]) => page.slug === slug);
    if (known) return known[0];
    const film = await this.get(`https://letterboxd.com/film/${slug}/`);
    const page = film && parseFilmPage(film.url, film.html);
    // The film's page gives its own short link, and so its code.
    const code = film && /boxd\.it\/([A-Za-z0-9]+)/.exec(film.html)?.[1];
    if (!page || !code) return undefined;
    await this.keep(code, page);
    return code;
  }

  private async keep(code: string, page: FilmPage): Promise<void> {
    this.pages[code] = page;
    this.fetched++;
    if (++this.unsaved >= 25) await this.save();
  }

  private async get(url: string): Promise<{ url: string; html: string } | undefined> {
    const wait = this.lastRequest + this.pause - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastRequest = Date.now();
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; chronicle)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429 || response.status === 403) {
        this.refused = true;
        return undefined;
      }
      if (!response.ok) return undefined;
      return { url: response.url, html: await response.text() };
    } catch {
      return undefined;
    }
  }

  /** What this run fetched, said once however many extractors share these pages. */
  report(): string | undefined {
    if (this.reported || (this.fetched === 0 && this.failed === 0)) return undefined;
    this.reported = true;
    return `Film pages: ${this.fetched} fetched, ${this.failed} could not be read`;
  }

  /** Whether Letterboxd turned a request away during this run. */
  get wasRefused(): boolean {
    return this.refused;
  }
}

const shared = new Map<string, Promise<FilmPages>>();

/**
 * The pages kept in one file. A run's extractors share them, so they read and
 * write the file as one and pace their requests together.
 */
export function filmPages(path: string, fetching: boolean): Promise<FilmPages> {
  const key = `${fetching}:${path}`;
  let pages = shared.get(key);
  if (!pages) {
    const opened = new FilmPages(path, fetching);
    pages = opened.load().then(() => opened);
    shared.set(key, pages);
  }
  return pages;
}
