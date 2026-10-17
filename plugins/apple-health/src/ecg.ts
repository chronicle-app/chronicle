import { posix } from 'node:path';
import { type HealthExport, instant } from './health.js';

/** An ECG recording's header: when it was taken, what it found, and on what. */
export interface Electrocardiogram {
  /** The recording's file name in the export's `electrocardiograms` folder. */
  file: string;
  /** When recording started, as an instant. */
  recorded: string;
  /** Apple's classification, such as `Sinus Rhythm` or `Inconclusive`. */
  classification: string;
  /** The watch's hardware identifier, such as `Watch6,14`. */
  hardware?: string;
}

// The header is a few short lines before the samples, and well under this.
const HEADER_BYTES = 4096;

/**
 * The export's ECG recordings, oldest first. Only each file's header is read.
 * Its name and date of birth rows are skipped, and so are the voltage samples.
 */
export async function readElectrocardiograms(health: HealthExport): Promise<Electrocardiogram[]> {
  const paths = (await health.files.list(health.electrocardiograms)).filter(path =>
    path.toLowerCase().endsWith('.csv')
  );
  const recordings: Electrocardiogram[] = [];
  for (const path of paths) {
    const header = parseHeader(await readHead(health, path));
    const recordedDate = header.get('Recorded Date');
    const classification = header.get('Classification');
    if (!recordedDate || !classification) continue;
    recordings.push({
      file: posix.basename(path),
      recorded: instant(recordedDate).toISOString(),
      classification,
      ...(header.get('Device') && { hardware: header.get('Device') }),
    });
  }
  return recordings.sort((a, b) => a.recorded.localeCompare(b.recorded));
}

/** The start of a file, enough for its header, without reading the rest. */
async function readHead(health: HealthExport, path: string): Promise<string> {
  const stream = await health.files.open(path);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
      length += (chunk as Buffer).length;
      if (length >= HEADER_BYTES) break;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks).subarray(0, HEADER_BYTES).toString('utf8');
}

// Rows the header gives that this plugin uses. Name and date of birth aren't among them.
const ROWS = new Set(['Recorded Date', 'Classification', 'Device']);

function parseHeader(text: string): Map<string, string> {
  const header = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const row = line.slice(0, comma);
    if (!ROWS.has(row)) continue;
    header.set(
      row,
      line
        .slice(comma + 1)
        .replace(/^"(.*)"$/, '$1')
        .trim()
    );
  }
  return header;
}
