import {
  ArchiveExtractor,
  countMonth,
  Extractor,
  type KindSurvey,
  Record,
  type Survey,
  type SurveyOptions,
} from '@chronicle.app/etl';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import {
  codeOf,
  defaultCachePath,
  type FilmPage,
  type FilmPages,
  filmPages,
} from '../filmPages.js';

/** What the export's `profile.csv` says about the member it belongs to. */
export interface LetterboxdAccount {
  username?: string;
  name?: string;
}

/** A film as a record carries it. */
export interface LetterboxdFilm {
  /** The film's code, from its `https://boxd.it/<code>` link. None when a diary row's film couldn't be told. */
  code?: string;
  name: string;
  /** The year of release, such as `1998`. */
  year?: string;
  /** What the film's page says, when it has been fetched. */
  page?: FilmPage;
}

export interface WatchRecord {
  film: LetterboxdFilm;
  /** The diary entry's code. None for a film marked watched with no entry. */
  entry?: string;
  /** The day the film was watched, such as `2024-09-07`. None with no entry. */
  watchedOn?: string;
  rewatch?: boolean;
  tags?: string[];
  occurredOn?: string;
}

export interface RatingRecord {
  film: LetterboxdFilm;
  /** The diary entry the rating was given on. None for the film's current rating. */
  entry?: string;
  rating: number;
  occurredOn?: string;
}

export interface ReviewRecord {
  film: LetterboxdFilm;
  entry: string;
  review: string;
  rating?: number;
  occurredOn?: string;
}

export interface WatchlistRecord {
  film: LetterboxdFilm;
  occurredOn?: string;
}

export interface LikeRecord {
  film?: LetterboxdFilm;
  /** The code of a liked review. */
  review?: string;
  occurredOn?: string;
}

type Row = { [column: string]: string | undefined };
type Section = [recordType: string, data: { film?: LetterboxdFilm; occurredOn?: string }];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: string | undefined) => (value && DAY.test(value) ? value : undefined);
const titleKey = (name: string | undefined, year: string | undefined) => `${name}\u0000${year}`;

/**
 * When Letterboxd made the export, from the name it gives the zip and its
 * folder, such as `letterboxd-pat-2026-11-14-20-49-utc`. None under another name.
 */
export function exportedAt(location: string): Date | undefined {
  const stamp = /letterboxd-.+-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-utc/.exec(location);
  if (!stamp) return undefined;
  const [, year, month, date, hour, minute] = stamp;
  const time = new Date(`${year}-${month}-${date}T${hour}:${minute}:00Z`);
  return Number.isNaN(time.getTime()) ? undefined : time;
}

/**
 * The Letterboxd data export: the zip that Settings → Data → "Export your
 * data" produces, a folder of CSVs, read as the zip or unpacked.
 *
 * The export names a film two ways. `watched.csv`, `ratings.csv`,
 * `watchlist.csv`, and `likes/films.csv` give the film's own short link, whose
 * code is the film's id. `diary.csv` and `reviews.csv` give the link of the
 * diary entry instead, so their rows find their film by its name and year
 * among the films the other files name.
 */
export abstract class LetterboxdArchiveExtractor extends ArchiveExtractor<
  typeof LetterboxdArchiveExtractor
> {
  static override source = 'letterboxd';
  static override strategy = 'archive';
  // The export is a re-read of the account as it is: a film's rating and the
  // watchlist are their latest, so they are sighted when the export was made.
  static override temporality = 'snapshot' as const;

  static override schema = Extractor.schema.extend({
    input: z.string().describe('The Letterboxd export, as a zip or its unpacked folder'),
    'film-pages': z
      .boolean()
      .optional()
      .describe(
        "Fetch each film's page from Letterboxd for its link and its IMDb and TMDB ids. One request per film, kept for later runs."
      ),
    'film-cache': z
      .string()
      .optional()
      .describe('The file fetched film pages are kept in. The default is in your cache folder.'),
  });

  protected override accountInfo: LetterboxdAccount = {};
  protected override readonly exportName = 'Letterboxd export';

  private compiledAt?: Date;
  private pages!: FilmPages;
  /** Film codes by name and year, from every file that names a film by its own link. */
  private films = new Map<string, Set<string>>();
  private unmatched = 0;

  override async setup(): Promise<void> {
    await super.setup();
    const config = this.config as z.infer<typeof LetterboxdArchiveExtractor.schema>;
    this.pages = await filmPages(
      config['film-cache'] ?? defaultCachePath(),
      config['film-pages'] === true
    );

    this.compiledAt = exportedAt(this.files.location) ?? (await this.newestFileTime());

    const [profile] = await this.readCsv('profile.csv');
    const name = [profile?.['Given Name'], profile?.['Family Name']].filter(Boolean).join(' ');
    this.accountInfo = {
      ...(profile?.Username && { username: profile.Username }),
      ...(name && { name }),
    };
  }

  override async teardown(): Promise<void> {
    await this.pages?.save();
    // Said as the run ends, when every extractor sharing the pages is done.
    const fetched = this.pages?.report();
    if (fetched) this.logger.info(fetched);
    await super.teardown();
  }

  /** The newest time among the export's files, or none when it has none. */
  private async newestFileTime(): Promise<Date | undefined> {
    let newest = 0;
    for (const path of await this.files.list()) {
      const modified = await this.files.modified(path);
      if (modified) newest = Math.max(newest, modified.getTime());
    }
    return newest > 0 ? new Date(newest) : undefined;
  }

  // The export is a file Letterboxd wrote once: what it says was so when it
  // was written, and reading it again says nothing new.
  protected override asOfTime(): Date {
    return this.compiledAt ?? super.asOfTime();
  }

  override occurredAt(record: Record): Date | undefined {
    const { occurredOn } = record.data as { occurredOn?: string };
    return occurredOn ? new Date(occurredOn) : undefined;
  }

  override titleOf(record: Record): string | undefined {
    return (record.data as { film?: LetterboxdFilm }).film?.name;
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const [recordType, data] of await this.sections()) {
      if (this.shouldStopExtracting(count)) break;
      if (data.film) await this.resolveFilm(data as { film: LetterboxdFilm; entry?: string });
      yield this.createRecordWithArchiveContext(data, { recordType });
      count++;
    }

    const fetching = (this.config as { 'film-pages'?: boolean })['film-pages'] === true;
    if (this.unmatched > 0 && !fetching) {
      this.hint(
        `${this.unmatched} diary ${this.unmatched === 1 ? 'entry names a film' : 'entries name films'} the export doesn't identify`,
        { action: 'Run again with `--film-pages` to look them up on Letterboxd.' }
      );
    }
    if (this.pages.wasRefused) {
      this.hint('Letterboxd stopped answering, so some film pages were not fetched', {
        action: 'Run again with `--film-pages` later to fetch the rest.',
      });
    }
  }

  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const kind: KindSurvey = { count: 0, ...(options.byMonth && { byMonth: {} }) };
    for (const [, data] of await this.sections()) {
      kind.count++;
      if (!data.occurredOn) continue;
      const time = new Date(data.occurredOn);
      if (!kind.earliest || time < kind.earliest) kind.earliest = time;
      if (!kind.latest || time > kind.latest) kind.latest = time;
      if (kind.byMonth) countMonth(kind.byMonth, time);
    }
    return { [this.recordType()]: kind };
  }

  override async determineCount(): Promise<number> {
    return (await this.sections()).length;
  }

  /** The record type this extractor reads. */
  private recordType(): string {
    return (this.constructor as typeof LetterboxdArchiveExtractor).recordTypes[0];
  }

  /**
   * Every record of this extractor's type a run reads, newest first, with the
   * undated last: a film marked watched with no diary entry has no day to sort
   * by.
   */
  private async sections(): Promise<Section[]> {
    const recordType = this.recordType();
    return (await this.allSections()).filter(([type]) => type === recordType);
  }

  /** Every record in the export, of every type. */
  private async allSections(): Promise<Section[]> {
    const [watched, ratings, watchlist, likedFilms, diary, reviews, likedReviews] =
      await Promise.all(
        [
          'watched.csv',
          'ratings.csv',
          'watchlist.csv',
          'likes/films.csv',
          'diary.csv',
          'reviews.csv',
          'likes/reviews.csv',
        ].map(file => this.readCsv(file))
      );

    this.films = new Map();
    for (const row of [...watched, ...ratings, ...watchlist, ...likedFilms]) {
      const code = codeOf(row['Letterboxd URI']);
      if (!code) continue;
      const key = titleKey(row.Name, row.Year);
      this.films.set(key, (this.films.get(key) ?? new Set()).add(code));
    }

    const sections: Section[] = [];
    const reviewed = new Map(
      reviews.map(row => [codeOf(row['Letterboxd URI']), row] as const).filter(([code]) => code)
    );
    const logged = new Set<string>();

    for (const row of diary) {
      const entry = codeOf(row['Letterboxd URI']);
      if (!entry || !row.Name) continue;
      const film = this.filmNamed(row);
      logged.add(titleKey(row.Name, row.Year));
      const tags = (row.Tags ?? '')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
      const watch: WatchRecord = {
        film,
        entry,
        ...(day(row['Watched Date']) && { watchedOn: day(row['Watched Date']) }),
        ...(row.Rewatch === 'Yes' && { rewatch: true }),
        ...(tags.length > 0 && { tags }),
        occurredOn: day(row['Watched Date']) ?? day(row.Date),
      };
      sections.push(['watches', watch]);

      // A rating given on an entry belongs to that entry. With a review, it
      // goes on the review; the two are one thing said about the film.
      const rating = Number.parseFloat(row.Rating ?? '');
      if (Number.isFinite(rating) && !reviewed.has(entry)) {
        const record: RatingRecord = { film, entry, rating, occurredOn: day(row.Date) };
        sections.push(['ratings', record]);
      }
    }

    for (const [entry, row] of reviewed) {
      if (!row.Review || !row.Name) continue;
      const rating = Number.parseFloat(row.Rating ?? '');
      const review: ReviewRecord = {
        film: this.filmNamed(row),
        entry: entry!,
        review: row.Review,
        ...(Number.isFinite(rating) && { rating }),
        occurredOn: day(row.Date),
      };
      sections.push(['reviews', review]);
    }

    // A film marked watched and never put in the diary: seen, on no known day.
    for (const row of watched) {
      const film = this.filmLinked(row);
      if (!film || logged.has(titleKey(row.Name, row.Year))) continue;
      const watch: WatchRecord = { film };
      sections.push(['watches', watch]);
    }

    for (const row of ratings) {
      const film = this.filmLinked(row);
      const rating = Number.parseFloat(row.Rating ?? '');
      if (!film || !Number.isFinite(rating)) continue;
      const record: RatingRecord = { film, rating, occurredOn: day(row.Date) };
      sections.push(['ratings', record]);
    }

    for (const row of watchlist) {
      const film = this.filmLinked(row);
      if (!film) continue;
      const record: WatchlistRecord = { film, occurredOn: day(row.Date) };
      sections.push(['watchlist', record]);
    }

    for (const row of likedFilms) {
      const film = this.filmLinked(row);
      if (!film) continue;
      const record: LikeRecord = { film, occurredOn: day(row.Date) };
      sections.push(['likes', record]);
    }

    for (const row of likedReviews) {
      const review = codeOf(row.Content);
      if (!review) continue;
      const record: LikeRecord = { review, occurredOn: day(row.Date) };
      sections.push(['likes', record]);
    }

    return sections
      .filter(([, data]) => this.withinWindow(data.occurredOn))
      .sort(([, a], [, b]) => (b.occurredOn ?? '').localeCompare(a.occurredOn ?? ''));
  }

  /** The film a row names by its own short link. */
  private filmLinked(row: Row): LetterboxdFilm | undefined {
    const code = codeOf(row['Letterboxd URI']);
    if (!code || !row.Name) return undefined;
    return { code, name: row.Name, ...(row.Year && { year: row.Year }) };
  }

  /**
   * The film a diary or review row names. Its code is known when exactly one
   * film in the export has its name and year.
   */
  private filmNamed(row: Row): LetterboxdFilm {
    const codes = this.films.get(titleKey(row.Name, row.Year));
    return {
      ...(codes?.size === 1 && { code: [...codes][0] }),
      name: row.Name!,
      ...(row.Year && { year: row.Year }),
    };
  }

  /**
   * Fill in what a film's page says, and the code of a diary row's film the
   * export left untold, when fetching is on. Done as each record is read, so a
   * limited run fetches only the pages it needs.
   */
  private async resolveFilm(data: { film: LetterboxdFilm; entry?: string }): Promise<void> {
    const { film } = data;
    if (!film.code && data.entry) {
      const code = await this.pages.filmOfEntry(data.entry);
      if (code) film.code = code;
      else this.unmatched++;
    }
    if (!film.code) return;
    const page = await this.pages.of(film.code);
    if (page) film.page = page;
  }

  /** One CSV of the export as rows by column, trimmed. Empty when the export has no such file. */
  private async readCsv(path: string): Promise<Row[]> {
    if (!(await this.files.has(path))) return [];
    const text = await this.files.readText(path);
    if (!text.trim()) return [];
    return parse(text, {
      columns: (header: string[]) => header.map(column => column.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    });
  }

  /** Whether a day clears the since/until window. An undated record always does. */
  private withinWindow(date: string | undefined): boolean {
    return date ? this.isWithinDateRange(new Date(date)) : true;
  }
}
