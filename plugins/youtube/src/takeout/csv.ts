import { parse } from 'csv-parse/sync';

/** A Takeout CSV as header-keyed rows. Fields regularly carry embedded
 * newlines (descriptions, comment JSON), so this is never line-splittable. */
export function parseTakeoutCsv(content: string): Record<string, string>[] {
  return parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
}
