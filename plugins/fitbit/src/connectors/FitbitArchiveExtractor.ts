import { open } from 'node:fs/promises';
import { ArchiveExtractor, type Extractor, InputNotFound, type Record } from '@chronicle.app/etl';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { type DayWindow, LocalClock, fitbitTime, isTimeZone } from '../time.js';
import FitbitTransformer from './FitbitTransformer.js';

const PROFILE = 'Personal & Account/Profile.csv';
const DAY = 24 * 60 * 60_000;
// Where a time is in the start and end of a heart rate file.
const READING_TIME = /"dateTime"\s*:\s*"([^"]+)"/g;
// How much of each end of a heart rate file holds its first or last reading.
const END_BYTES = 256;

/** Whose archive it is, from `Personal & Account/Profile.csv`. */
export interface FitbitProfile {
  /** Fitbit's encoded user ID, such as `2ABCDE`. */
  id: string;
  name?: string;
  email?: string;
  /** The profile's time zone, such as `America/Toronto`. */
  timeZone: string;
  /** Height in meters. */
  height?: number;
}

/** One file of a series, with the date in its name. */
export interface SeriesFile {
  path: string;
  date: string;
}

/**
 * The archive Fitbit's Data Export page made, `MyFitbitData/<Name>/`, as a
 * folder or a zip: a folder for each category, such as `Sleep` and
 * `Physical Activity`, each holding JSON files that split a series by date.
 * Each kind reads the files of its series and gives its records newest
 * first.
 *
 * The archive mixes clocks. Heart rate, steps, and exercises are in UTC.
 * Sleep and weight are local times without an offset, which `clock` turns
 * into instants.
 */
export default abstract class FitbitArchiveExtractor extends ArchiveExtractor<
  typeof FitbitArchiveExtractor
> {
  static override source = 'fitbit';
  static override strategy = 'archive';
  static override defaultTransformer = FitbitTransformer;
  static override newestFirst = true;

  static override schema = ArchiveExtractor.schema.extend({
    input: z
      .string()
      .describe('The Fitbit archive: MyFitbitData, its zip, or the folder in it named for you'),
  }) as any;

  protected override readonly exportName = 'Fitbit archive';

  /** The path the archive's folders start at, such as `MyFitbitData/Sam/`. */
  protected root = '';
  protected profile!: FitbitProfile;
  protected clock!: LocalClock;
  private writtenAt?: Date;

  override async setup(): Promise<void> {
    await super.setup();
    const path = await this.files.find('Profile.csv');
    if (!path?.endsWith(PROFILE)) {
      throw new InputNotFound('That isn’t a Fitbit archive', {
        path: this.files.location,
        hint: 'Pass the MyFitbitData folder or its zip with `--input <path>`.',
      });
    }
    this.root = path.slice(0, -PROFILE.length);
    this.profile = await this.loadAccountInfo();
    this.accountInfo = this.profile;
    this.writtenAt = (await this.files.modified(path)) ?? undefined;
    this.clock = new LocalClock(this.profile.timeZone, date => this.dayWindow(date));
  }

  /** When Fitbit wrote the archive, so a second run over it gives the same records. */
  protected override asOfTime(): Date {
    return this.writtenAt ?? super.asOfTime();
  }

  protected override async loadAccountInfo(): Promise<FitbitProfile> {
    const [row = {}] = await this.readCsv(`${this.root}${PROFILE}`);
    const id = given(row.id);
    if (!id) {
      throw new InputNotFound('The Fitbit archive’s Profile.csv names no account', {
        path: this.files.location,
        hint: 'Pass the whole MyFitbitData folder or its zip with `--input <path>`.',
      });
    }
    let timeZone = given(row.timezone);
    if (!timeZone || !isTimeZone(timeZone)) {
      this.logger.warn(
        'The archive names no time zone, so its sleep and weight times are read as UTC'
      );
      timeZone = 'UTC';
    }
    const height = Number(row.height);
    return {
      id,
      ...(given(row.full_name) && { name: given(row.full_name) }),
      ...(given(row.email_address) && { email: given(row.email_address) }),
      timeZone,
      // A metric profile gives height in centimeters, and any other in inches.
      ...(height > 0 && { height: row.height_unit === 'METRIC' ? height / 100 : height * 0.0254 }),
    };
  }

  protected async readCsv(path: string): Promise<Array<{ [column: string]: string | undefined }>> {
    if (!(await this.files.has(path))) return [];
    return parse(await this.files.readText(path), {
      columns: (header: string[]) => header.map(column => column.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
    });
  }

  /**
   * The files of a series, such as `heart_rate` in `Physical Activity`, newest
   * first by the date in their names, `heart_rate-2022-07-15.json`.
   */
  protected async series(folder: string, name: string): Promise<SeriesFile[]> {
    const prefix = `${this.root}${folder}/${name}-`;
    return (await this.files.list(prefix))
      .flatMap(path => {
        const date = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(path.slice(prefix.length))?.[1];
        return date ? [{ path, date }] : [];
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Every entry in the JSON files of a series, each file a list. */
  protected async *entries<T>(files: SeriesFile[]): AsyncGenerator<T> {
    for (const { path } of files) {
      yield* await this.files.readJson<T[]>(path);
    }
  }

  /**
   * Whether a local date's records can fall in the run's range. A local day
   * is at most 14 hours from the UTC day of the same date, so this allows a
   * day on each side.
   */
  protected mayHold(date: string): boolean {
    const day = Date.parse(`${date}T00:00:00Z`);
    const { since, until } = this.config;
    return !(since && day + 2 * DAY < since.getTime()) && !(until && day - DAY > until.getTime());
  }

  protected inRange(instant: number): boolean {
    return this.isWithinDateRange(new Date(instant));
  }

  protected record(data: object, assertedAt?: number): Record {
    const recordType = (this.constructor as typeof Extractor).recordTypes[0];
    return this.createRecord(
      data,
      { recordType, profile: this.profile },
      assertedAt === undefined ? {} : { assertedAt: new Date(assertedAt) }
    );
  }

  override occurredAt(record: Record): Date | undefined {
    const at = record.data?.startTime ?? record.data?.timestamp;
    return at ? new Date(at) : undefined;
  }

  /** The first and last heart rate readings of a local day, from that day's file. */
  private async dayWindow(date: string): Promise<DayWindow | null> {
    const path = `${this.root}Physical Activity/heart_rate-${date}.json`;
    if (!(await this.files.has(path))) return null;
    const [head, tail] = await this.ends(path);
    const first = [...head.matchAll(READING_TIME)].at(0)?.[1];
    const last = [...tail.matchAll(READING_TIME)].at(-1)?.[1];
    if (!first || !last) return null;
    return { first: fitbitTime(first), last: fitbitTime(last) };
  }

  /**
   * The start and end of a file. In a folder only those bytes are read; a file
   * in a zip is read whole, as the zip only streams it.
   */
  private async ends(path: string): Promise<[string, string]> {
    const local = this.files.location.toLowerCase().endsWith('.zip')
      ? null
      : await this.files.localPath(path);
    if (!local) {
      const text = await this.files.readText(path);
      return [text.slice(0, END_BYTES), text.slice(-END_BYTES)];
    }
    const file = await open(local);
    try {
      const { size } = await file.stat();
      const length = Math.min(END_BYTES, size);
      const head = Buffer.alloc(length);
      const tail = Buffer.alloc(length);
      await file.read(head, 0, length, 0);
      await file.read(tail, 0, length, size - length);
      return [head.toString('utf8'), tail.toString('utf8')];
    } finally {
      await file.close();
    }
  }
}

/** A profile field's value, when it has one. Fitbit writes a missing value as `null`. */
function given(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text !== 'null' ? text : undefined;
}
