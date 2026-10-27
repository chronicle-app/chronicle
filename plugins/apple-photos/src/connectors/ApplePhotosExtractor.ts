import {
  Extractor,
  Record,
  countMonth,
  type KindSurvey,
  type Survey,
  type SurveyOptions,
} from '@chronicle.app/etl';
import { getICloudAccount, type ICloudAccount } from '@chronicle.app/apple';
import { z } from 'zod';
import { DATABASES, PhotosLibrary, SYSTEM_LIBRARY } from '../library.js';
import ApplePhotosTransformer from './ApplePhotosTransformer.js';

/** One record of a kind, with when it happened, which orders the kind. */
export interface Found<T> {
  key: string;
  time: string;
  data: T;
}

/**
 * Your Photos library on this Mac. Each kind reads the library on its own,
 * gathers what it finds, and gives it newest first.
 */
export default abstract class ApplePhotosExtractor extends Extractor<typeof ApplePhotosExtractor> {
  static override source = 'apple-photos';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override defaultTransformer = ApplePhotosTransformer;
  static override newestFirst = true;
  // What a run and a survey read, which a library's Photos.sqlite must have.
  static databases = DATABASES;

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the Photos library').default(SYSTEM_LIBRARY),
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

  /** Whose library it is: the iCloud account, so the records can name you. */
  protected account: ICloudAccount | null = null;
  protected library: PhotosLibrary | null = null;
  /** When the library last changed, which a snapshot is read as of. */
  private libraryChanged: Date | null = null;
  private found: Array<Found<unknown>> | null = null;

  override async setup(): Promise<void> {
    await super.setup();
    this.library = PhotosLibrary.open(this.libraryPath());
    this.libraryChanged = this.library.lastChanged();
    this.account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;
  }

  override async teardown(): Promise<void> {
    this.library?.close();
    this.library = null;
    await super.teardown();
  }

  /** The library this kind reads. */
  protected libraryPath(): string {
    return this.config.input;
  }

  /** This kind's records, in any order. */
  protected abstract read(library: PhotosLibrary): Array<Found<unknown>>;

  /**
   * When each of this kind's records happened, as `read()` dates them, for a
   * survey. A kind that can date its records without reading all of each
   * says so more cheaply.
   */
  protected times(library: PhotosLibrary): string[] {
    return this.read(library).map(found => found.time);
  }

  /**
   * When the library last changed, not when the run started, so an
   * unchanged library gives the same records on every run.
   */
  protected override asOfTime(): Date {
    return this.libraryChanged ?? super.asOfTime();
  }

  override keyOf(record: Record): string | null {
    return (record.context as { key?: string }).key ?? null;
  }

  override occurredAt(record: Record): Date | undefined {
    const { occurredAt } = record.context as { occurredAt?: string };
    return occurredAt ? new Date(occurredAt) : undefined;
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const { key, time, data } of this.all()) {
      if (this.shouldStopExtracting(count)) break;
      yield this.createRecord(data, { key, occurredAt: time, account: this.account });
      count++;
    }
  }

  override async determineCount(): Promise<number | null> {
    const limit = this.getEffectiveLimit();
    const count = this.all().length;
    return limit === null ? count : Math.min(limit, count);
  }

  /** The records a run reads within `--since` and `--until`, and when they happened. */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.library) return null;
    const kind: KindSurvey = { count: 0, ...(options.byMonth && { byMonth: {} }) };
    for (const time of this.times(this.library)) {
      const at = new Date(time);
      if (!this.inRange(at.getTime())) continue;
      kind.count++;
      if (!kind.earliest || at < kind.earliest) kind.earliest = at;
      if (!kind.latest || at > kind.latest) kind.latest = at;
      if (kind.byMonth) countMonth(kind.byMonth, at);
    }
    const [recordType] = (this.constructor as typeof ApplePhotosExtractor).recordTypes;
    return { [recordType]: kind };
  }

  /** Whether a time, in milliseconds, is within `--since` and `--until`. */
  protected inRange(time: number): boolean {
    const { since, until } = this.config;
    return (!since || time >= since.getTime()) && (!until || time <= until.getTime());
  }

  /** What this kind found within `--since` and `--until`, newest first. */
  private all(): Array<Found<unknown>> {
    if (!this.found) {
      if (!this.library) throw new Error('Library not opened');
      const at = (found: Found<unknown>) => Date.parse(found.time);
      this.found = this.read(this.library)
        .filter(found => this.inRange(at(found)))
        // Newest first. Ties keep the order they were read in.
        .sort((a, b) => at(b) - at(a));
    }
    return this.found;
  }
}
