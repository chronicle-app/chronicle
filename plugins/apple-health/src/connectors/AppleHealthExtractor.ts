import { Extractor, Record } from '@chronicle.app/etl';
import { getICloudAccount } from '@chronicle.app/apple';
import { EXIT_CODES, ExtractorError } from '@chronicle.app/logging';
import { z } from 'zod';
import { type HealthDevice, parseDevice } from '../device.js';
import {
  type HealthElement,
  type HealthExport,
  type HealthSample,
  instant,
  locateExport,
  readExport,
  shortType,
  sourceDevices,
} from '../health.js';
import { BLOOD_PRESSURE_PARTS, convert, type ReadingType, SERIES } from '../readings.js';
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
    series: z
      .string()
      .optional()
      .describe(
        'Only these series, comma-separated, such as RestingHeartRate,RespiratoryRate. Each is read by its kind'
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
  // The series of this kind the run reads, by Health's type without its prefix.
  private series = new Set<string>();
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
    const kind = (this.constructor as typeof AppleHealthExtractor).recordTypes[0];
    this.series = seriesOf(kind, this.config.series);
    // The export doesn't say whose it is, so it's taken to be this Mac's iCloud account's.
    this.account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;
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

  /** Whether the run reads a type, given by Health's identifier for it or as a series. */
  protected wants(type: string): boolean {
    return this.series.has(shortType(type));
  }

  /**
   * The export's samples and correlations of the types the run reads, once the
   * export's devices are known. When it reads none of them, the export isn't read.
   */
  protected async *elements(
    records: string[],
    correlations: string[] = []
  ): AsyncGenerator<HealthElement> {
    const wanted = {
      records: new Set(records.filter(type => this.wants(type))),
      correlations: new Set(correlations.filter(type => this.wants(type))),
    };
    if (wanted.records.size === 0 && wanted.correlations.size === 0) return;
    this.devices = await sourceDevices(this.health);
    yield* readExport(this.health, wanted);
  }

  /**
   * A reading for each sample of a type in `table`, and for each correlation,
   * such as a blood pressure. A correlation is one reading with all its values,
   * timed and sourced as the correlation is. The export repeats its values as
   * separate samples, which aren't read.
   */
  protected async *readingsOf(
    table: { [type: string]: ReadingType },
    correlations: string[] = []
  ): AsyncGenerator<Found> {
    for await (const element of this.elements(Object.keys(table), correlations)) {
      if (element.kind === 'record') {
        const { sample } = element;
        const reading = this.readingOf(sample, table[sample.type], this.deviceOf(sample.device));
        if (reading) yield reading;
        continue;
      }
      const { correlation } = element;
      const parts = correlation.samples.flatMap(sample => {
        const part = BLOOD_PRESSURE_PARTS[sample.type];
        return part ? [this.readingOf(sample, part, null)] : [];
      });
      if (parts.length === 0 || parts.includes(null)) continue;
      yield {
        ...this.measuredBy(correlation, this.deviceOf(correlation.device)),
        values: this.share(Object.assign({}, ...parts.map(part => part!.values))),
      };
    }
  }

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
 * The series of `kind` a run reads: all of them, or those `--series` names. A
 * run can read several kinds, so a name can be any kind's series. Names match
 * whatever their case, and with or without HealthKit's prefix.
 */
function seriesOf(kind: string, asked: string | undefined): Set<string> {
  const names = (asked ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);
  if (names.length === 0) return new Set(SERIES[kind]);
  const known = new Map(
    Object.values(SERIES)
      .flat()
      .map(name => [name.toLowerCase(), name])
  );
  const unknown = names.filter(name => !known.has(shortType(name).toLowerCase()));
  if (unknown.length > 0) {
    const listed = Object.entries(SERIES).map(([of, series]) => `${of}: ${series.join(', ')}`);
    throw new ExtractorError(
      `Apple Health has no series ${unknown.map(name => `"${name}"`).join(', ')}`,
      {
        code: 'unknown-series',
        exitCode: EXIT_CODES.usage,
        hint: `The series of each kind are ${listed.join('; ')}.`,
      }
    );
  }
  const wanted = new Set(names.map(name => known.get(shortType(name).toLowerCase())));
  return new Set(SERIES[kind].filter(name => wanted.has(name)));
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
