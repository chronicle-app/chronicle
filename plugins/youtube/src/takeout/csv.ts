import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

/** A Takeout CSV as header-keyed rows. Fields regularly carry embedded
 * newlines (descriptions, comment JSON), so this is never line-splittable. */
export async function readTakeoutCsv(path: string): Promise<Record<string, string>[]> {
  const content = await readFile(path, 'utf-8');
  return parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
}
