import { Extractor, Record } from '@chronicle.app/etl';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import type { HealthDevice } from '../device.js';
import {
  type HealthExport,
  type HealthSample,
  instant,
  locateExport,
  shortType,
  sourceDevices,
} from '../health.js';
import { convert, type Reading, type ReadingType } from '../readings.js';
import AppleHealthTransformer from './AppleHealthTransformer.js';

/**
 * The export the Health app makes from Profile → Export All Health Data,
 * zipped or not. It holds everything Health keeps, from every device and app
 * that writes to it, in one large `export.xml`. Each kind reads the file on
 * its own, as it streams past.
 */
export default abstract class AppleHealthExtractor extends Extractor<typeof AppleHealthExtractor> {
  static override source = 'apple-health';
  static override delivery = 'export' as const;
  static override strategy = 'archive';
  static override default = true;
  static override defaultTransformer = AppleHealthTransformer;

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
    let count = 0;
    for await (const record of this.records()) {
      if (this.shouldStopExtracting(count)) break;
      yield record;
      count++;
    }
    this.hintUnconverted();
  }

  protected abstract records(): AsyncGenerator<Record>;

  /** A record of this extractor's kind, carrying whose export it is. */
  protected recordOf(data: unknown): Record {
    const recordType = (this.constructor as typeof AppleHealthExtractor).recordTypes[0];
    return this.createRecord(data, { recordType, account: this.account });
  }

  protected inRange(start: string): boolean {
    const date = new Date(start);
    if (this.config.since && date < this.config.since) return false;
    if (this.config.until && date > this.config.until) return false;
    return true;
  }

  /**
   * A sample's source as a reading names it: a device when the export
   * describes one for it, and an app otherwise. A sample that doesn't describe
   * its device takes what other samples say about it, but not the OS release,
   * which changes over time.
   */
  protected sourceOf(sample: Pick<HealthSample, 'sourceName'>, own: HealthDevice | null) {
    const { software: _release, ...known } = this.devices.get(sample.sourceName) ?? {};
    const device = own ?? (Object.keys(known).length > 0 ? known : null);
    return { sourceName: sample.sourceName, app: device === null, device };
  }

  /** A sample's value as a reading, or null when its unit has no conversion. */
  protected readingOf(
    sample: HealthSample,
    readingType: ReadingType,
    own: HealthDevice | null
  ): Reading | null {
    const value = convert(readingType, sample.value, sample.unit);
    if (value === null) {
      const label = `${shortType(sample.type)} in ${sample.unit ?? 'no unit'}`;
      this.unconverted.set(label, (this.unconverted.get(label) ?? 0) + 1);
      return null;
    }
    return { ...this.measuredBy(sample, own), values: { [readingType.property]: value } };
  }

  /** Everything about a reading but its values: what, when, and by what. */
  protected measuredBy(
    sample: Omit<HealthSample, 'unit' | 'value'>,
    own: HealthDevice | null
  ): Omit<Reading, 'values'> {
    return {
      type: shortType(sample.type),
      ...this.sourceOf(sample, own),
      start: instant(sample.startDate).toISOString(),
      end: instant(sample.endDate).toISOString(),
      ...(sample.metadata.HKTimeZone && { timeZone: sample.metadata.HKTimeZone }),
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
