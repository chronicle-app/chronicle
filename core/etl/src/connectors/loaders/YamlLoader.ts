import { writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { z } from 'zod';
import { Loader } from '../../loader.js';
import { LoadResult, Record } from '../../types.js';

export class YamlLoader extends Loader<typeof YamlLoader> {
  static override source = 'yaml';
  static override schema = z.object({
    output: z.string().optional().describe('Output file path (default: stdout)'),
    indent: z.number().default(2).describe('Number of spaces for indentation'),
    'flow-level': z
      .number()
      .default(-1)
      .describe('Flow level for compact arrays/objects (-1 for block style)'),
  });

  private records: any[] = [];

  async load(record: Record): Promise<LoadResult> {
    // Keep nested structure for YAML - don't flatten
    this.records.push(record.data);

    return { success: true, record };
  }

  override async teardown(): Promise<void> {
    if (this.records.length === 0) return;

    const yamlOptions = {
      indent: this.config.indent,
      flowLevel: this.config['flow-level'],
      noRefs: true, // Prevent reference anchors for cleaner output
    };

    // Output as array if multiple records, single object if one record
    const data = this.records.length === 1 ? this.records[0] : this.records;
    const output = yaml.dump(data, yamlOptions);

    if (this.config.output) {
      writeFileSync(this.config.output, output);
    } else {
      process.stdout.write(output);
    }
  }
}
