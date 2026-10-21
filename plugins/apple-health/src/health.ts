import { stat } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { type ExportFiles, fileError, openExport } from '@chronicle.app/etl';
import { InputNotFound } from '@chronicle.app/logging';
import { SaxesParser } from 'saxes';
import { type HealthDevice, parseDevice } from './device.js';

/** One `<Record>`: a sample as Health stores it, with its metadata entries. */
export interface HealthSample {
  /** The full HealthKit identifier, such as `HKQuantityTypeIdentifierHeartRate`. */
  type: string;
  /** The device or app that wrote the sample, by the name it goes by in Health. */
  sourceName: string;
  sourceVersion?: string;
  /** HealthKit's description of the device, such as `<<HKDevice: 0x…>, name:Apple Watch, …>`. */
  device?: string;
  unit?: string;
  value?: string;
  creationDate?: string;
  startDate: string;
  endDate: string;
  metadata: { [key: string]: string };
}

/** One `<Correlation>`: samples Health groups, such as a blood pressure's two values. */
export interface HealthCorrelation extends Omit<HealthSample, 'unit' | 'value'> {
  samples: HealthSample[];
}

export type HealthElement =
  | { kind: 'record'; sample: HealthSample }
  | { kind: 'correlation'; correlation: HealthCorrelation };

/** A Health export's files, and where `export.xml` and the ECG recordings are among them. */
export interface HealthExport {
  files: ExportFiles;
  xml: string;
  /** The folder of ECG recordings, as a prefix of their paths. */
  electrocardiograms: string;
}

/**
 * Open the export from what was passed: the `export.zip` the Health app
 * makes, the `apple_health_export` folder it unzips to, a folder that holds
 * either, or `export.xml` itself, which is read with the folder it's in.
 */
export async function locateExport(input: string): Promise<HealthExport> {
  const root = basename(input).toLowerCase().endsWith('.xml') ? dirname(input) : input;
  const files = await openExport(root);
  const xml = await files.find('export.xml');
  if (!xml) {
    await files.close();
    throw new InputNotFound('No export.xml in the export', {
      path: input,
      hint: 'Pass the Health app’s `export.zip`, or the folder it unzips to, with `--input <path>`.',
    });
  }
  const folder = posix.dirname(xml);
  return {
    files,
    xml,
    electrocardiograms: `${folder === '.' ? '' : `${folder}/`}electrocardiograms/`,
  };
}

/** A file of the export as text, as it streams. Stopping early closes the file. */
async function* textOf(health: HealthExport, path: string): AsyncGenerator<string> {
  const stream = await health.files.open(path);
  stream.setEncoding('utf8');
  try {
    for await (const chunk of stream) yield chunk as string;
  } catch (error) {
    throw fileError(error, health.files.location, 'Health export');
  } finally {
    stream.destroy();
  }
}

/**
 * Stream the export's top-level `<Record>` and `<Correlation>` elements whose
 * types are wanted, in file order. Every other element is skipped as it's
 * parsed, so memory stays flat however large the export is.
 */
export async function* readExport(
  health: HealthExport,
  wanted: { records?: ReadonlySet<string>; correlations?: ReadonlySet<string> }
): AsyncGenerator<HealthElement> {
  const parser = new SaxesParser();
  const ready: HealthElement[] = [];
  // The element being read, and how deep inside the document it opened.
  let sample: HealthSample | null = null;
  let correlation: HealthCorrelation | null = null;
  let depth = 0;
  let failure: Error | null = null;

  parser.on('opentag', node => {
    depth++;
    const attributes = node.attributes as { [name: string]: string };
    // HealthData is depth 1, so the elements it holds are depth 2.
    if (depth === 2) {
      if (node.name === 'Record' && wanted.records?.has(attributes.type)) {
        sample = sampleOf(attributes);
      } else if (node.name === 'Correlation' && wanted.correlations?.has(attributes.type)) {
        correlation = { ...sampleOf(attributes), samples: [] };
      }
    } else if (node.name === 'MetadataEntry' && depth === 3) {
      const target = sample ?? correlation;
      if (target) target.metadata[attributes.key] = attributes.value;
    } else if (node.name === 'Record' && depth === 3 && correlation) {
      sample = sampleOf(attributes);
    } else if (node.name === 'MetadataEntry' && depth === 4 && sample) {
      sample.metadata[attributes.key] = attributes.value;
    }
  });
  parser.on('closetag', node => {
    if (node.name === 'Record' && sample && depth === 3 && correlation) {
      correlation.samples.push(sample);
      sample = null;
    } else if (depth === 2) {
      if (sample) ready.push({ kind: 'record', sample });
      if (correlation) ready.push({ kind: 'correlation', correlation });
      sample = null;
      correlation = null;
    }
    depth--;
  });
  parser.on('error', error => {
    failure ??= error;
  });

  for await (const chunk of textOf(health, health.xml)) {
    parser.write(chunk);
    if (failure) throw failure;
    yield* ready.splice(0);
  }
  parser.close();
  if (failure) throw failure;
  yield* ready.splice(0);
}

const devicesByExport = new Map<string, Promise<Map<string, HealthDevice>>>();

/**
 * The devices among the export's sources, by the name each goes by in Health,
 * such as `Sam’s Apple Watch`. A source that never describes a device, such
 * as Sleep Diary, is an app. Some types never carry a device, such as sleep
 * and resting heart rate, so this reads the whole export once and remembers
 * it for the run.
 */
export async function sourceDevices(health: HealthExport): Promise<Map<string, HealthDevice>> {
  const { location } = health.files;
  // export.xml when the export is a folder, or the zip it's in.
  const { mtimeMs, size } = await stat(join(location, health.xml)).catch(() => stat(location));
  const id = `${location}|${health.xml}|${mtimeMs}|${size}`;
  let devices = devicesByExport.get(id);
  if (!devices) {
    devices = scanDevices(health);
    devicesByExport.set(id, devices);
  }
  return devices;
}

async function scanDevices(health: HealthExport): Promise<Map<string, HealthDevice>> {
  const parser = new SaxesParser();
  const devices = new Map<string, HealthDevice>();
  let depth = 0;
  let failure: Error | null = null;
  parser.on('opentag', node => {
    depth++;
    if (depth !== 2) return;
    const { sourceName, device } = node.attributes as { [name: string]: string };
    if (!sourceName || !device) return;
    const known = devices.get(sourceName);
    if (known?.hardware) return;
    const parsed = parseDevice(device);
    if (parsed && (!known || parsed.hardware)) devices.set(sourceName, parsed);
  });
  parser.on('closetag', () => {
    depth--;
  });
  parser.on('error', error => {
    failure ??= error;
  });
  for await (const chunk of textOf(health, health.xml)) {
    parser.write(chunk);
    if (failure) throw failure;
  }
  parser.close();
  return devices;
}

function sampleOf(attributes: { [name: string]: string }): HealthSample {
  const { type, sourceName, sourceVersion, device, unit, value, creationDate, startDate, endDate } =
    attributes;
  return {
    type,
    sourceName,
    ...(sourceVersion !== undefined && { sourceVersion }),
    ...(device !== undefined && { device }),
    ...(unit !== undefined && { unit }),
    ...(value !== undefined && { value }),
    ...(creationDate !== undefined && { creationDate }),
    startDate,
    endDate,
    metadata: {},
  };
}

/**
 * A Health date, such as `2025-01-01 08:00:30 -0500`, as an instant. The
 * offset is the one in effect when the export was made, not where the sample
 * was taken, so the instant is right but the local time may not be.
 */
export function instant(date: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(date);
  if (!match) throw new Error(`Unexpected Health date: ${date}`);
  const [, day, time, hours, minutes] = match;
  return new Date(`${day}T${time}${hours}:${minutes}`);
}

/** The identifier without HealthKit's prefix, such as `HeartRate`. */
export function shortType(type: string): string {
  return type.replace(/^HK(Quantity|Category|Correlation)TypeIdentifier/, '');
}
