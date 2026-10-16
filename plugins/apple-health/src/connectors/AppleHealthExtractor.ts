import { Extractor, Record } from '@chronicle.app/etl';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import { type HealthDevice, parseDevice } from '../device.js';
import {
  type HealthExport,
  type HealthSample,
  instant,
  locateExport,
  shortType,
  sourceDevices,
} from '../health.js';
import { convert, type ReadingType } from '../readings.js';
import AppleHealthTransformer from './AppleHealthTransformer.js';

/**
 * The export the Health app makes from Profile → Export All Health Data,
 * zipped or not. It holds everything Health keeps, from every device and app
 * that writes to it, in one large `export.xml`. Each kind reads the file on
 * its own, as it streams past. The file keeps no useful order, so a kind
 * gathers what it reads and gives it newest first.
 */
export default abstract class AppleHealthExtractor extends Extractor<typeof AppleHealthExtractor> {
  static override source = 'apple-health';
  static override delivery = 'export' as const;
  static override strategy = 'archive';
  static override defaultTransformer = AppleHealthTransformer;
  static override newestFirst = true;

  static override schema = Extractor.schema.extend({
    input: z
      .string()
      .describe(
        'Path to the Health export: export.zip, the folder it unzips to, or its export.xml'
      ),
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

  protected health!: HealthExport;
  protected devices = new Map<string, HealthDevice>();
  private account: unknown = null;
  // Each device description parsed once. The same device's descriptions differ only by an address.
  private parsed = new Map<string, HealthDevice | null>();
  // What many readings have in common, such as their type and source, or their
  // values, as one object each. A kind holds all it finds until it can sort it,
  // and a large export has hundreds of thousands of readings.
  private shared = new Map<string, object>();
  // Samples left out because their unit has no conversion, by type and unit.
  private unconverted = new Map<string, number>();

  override async setup(): Promise<void> {
    await super.setup();
    this.health = await locateExport(this.config.input);
    // The export doesn't say whose it is, so it's taken to be this Mac's iCloud account's.
    this.account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;
    this.devices = await sourceDevices(this.health);
  }

  override async teardown(): Promise<void> {
    await this.health?.files.close();
    await super.teardown();
  }

  async *extract(): AsyncGenerator<Record> {
    const found: Found[] = [];
    for await (const item of this.read()) {
      if (this.inRange(item.start)) found.push(item);
    }
    // Newest first by when each started, then by when it ended. Ties keep the
    // order they were read in.
    found.sort((a, b) => b.start - a.start || b.end - a.end);
    let count = 0;
    for (const { by, start, end, ...rest } of found) {
      if (this.shouldStopExtracting(count)) break;
      const [from, to] = [new Date(start).toISOString(), new Date(end).toISOString()];
      yield this.recordOf({ ...by, start: from, end: to, ...rest });
      count++;
    }
    this.hintUnconverted();
  }

  override occurredAt(record: Record): Date | undefined {
    return new Date((record.data as { start: string }).start);
  }

  /** What this kind finds in the export, in the order it's read. */
  protected abstract read(): AsyncGenerator<Found>;

  /** A record of this extractor's kind, carrying whose export it is. */
  private recordOf(data: unknown): Record {
    const recordType = (this.constructor as typeof AppleHealthExtractor).recordTypes[0];
    return this.createRecord(data, { recordType, account: this.account });
  }

  private inRange(start: number): boolean {
    if (this.config.since && start < this.config.since.getTime()) return false;
    if (this.config.until && start > this.config.until.getTime()) return false;
    return true;
  }

  /**
   * One object for every value like this one. It's a copy, since the parser's
   * strings are slices of the text it read and would keep that in memory.
   */
  protected share<T extends object>(value: T): T {
    const key = JSON.stringify(value);
    let copy = this.shared.get(key);
    if (!copy) this.shared.set(key, (copy = JSON.parse(key) as object));
    return copy as T;
  }

  /**
   * A sample's source as a reading names it: a device when the export
   * describes one for it, and an app otherwise. A sample that doesn't describe
   * its device takes what other samples say about it.
   */
  protected sourceOf(sample: Pick<HealthSample, 'sourceName'>, own: HealthDevice | null) {
    const device = own ?? this.devices.get(sample.sourceName) ?? null;
    return { sourceName: sample.sourceName, app: device === null, device };
  }

  /** The device a sample describes, if it describes one. */
  protected deviceOf(description: string | undefined): HealthDevice | null {
    if (!description) return null;
    const known = description.replace(/^<<HKDevice: 0x[0-9a-f]+>/, '');
    if (!this.parsed.has(known)) this.parsed.set(known, parseDevice(description));
    return this.parsed.get(known)!;
  }

  /** A sample's value as a reading, or null when its unit has no conversion. */
  protected readingOf(
    sample: HealthSample,
    readingType: ReadingType,
    own: HealthDevice | null
  ): Found | null {
    const value = convert(readingType, sample.value, sample.unit);
    if (value === null) {
      const label = `${shortType(sample.type)} in ${sample.unit ?? 'no unit'}`;
      this.unconverted.set(label, (this.unconverted.get(label) ?? 0) + 1);
      return null;
    }
    return {
      ...this.measuredBy(sample, own),
      values: this.share({ [readingType.property]: value }),
    };
  }

  /** Everything about a reading but its values: what, when, and by what. */
  protected measuredBy(
    sample: Omit<HealthSample, 'unit' | 'value'>,
    own: HealthDevice | null
  ): Found {
    const timeZone = sample.metadata.HKTimeZone;
    return {
      by: this.share({
        type: shortType(sample.type),
        ...this.sourceOf(sample, own),
        ...(timeZone && { timeZone }),
      }),
      start: instant(sample.startDate).getTime(),
      end: instant(sample.endDate).getTime(),
    };
  }

  /** Say when samples were left out for a unit there's no conversion for. */
  private hintUnconverted(): void {
    if (this.unconverted.size === 0) return;
    const total = [...this.unconverted.values()].reduce((sum, n) => sum + n, 0);
    const kinds = [...this.unconverted.keys()].join(', ');
    this.hint(`${total} ${total === 1 ? 'sample was' : 'samples were'} left out: ${kinds}`, {
      action: 'Their unit isn’t one Chronicle converts yet. Report it so it can be added.',
    });
  }
}

/**
 * What a kind finds, a reading or a period of sleep, as it waits to be sorted:
 * when it started and ended, in milliseconds, and what it has in common with
 * others like it (`by`), shared among them. Its record holds all of it, with
 * the times as instants.
 */
export interface Found {
  by: object;
  start: number;
  end: number;
  [field: string]: unknown;
}
