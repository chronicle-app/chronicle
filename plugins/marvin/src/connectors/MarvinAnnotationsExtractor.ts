import { Record } from '@chronicle.app/etl';
import { MarvinExtractor } from './MarvinExtractor.js';
import MarvinTransformer from './marvin-transformer.js';

export class MarvinAnnotationsExtractor extends MarvinExtractor {
  static override description = 'Highlights and annotations';
  static override recordTypes: string[] = ['annotations'];
  static override defaultTransformer = MarvinTransformer;

  override async *extract(): AsyncGenerator<Record> {
    // Read all CSV rows and yield as annotation records
    let count = 0;
    for await (const record of super.extract()) {
      const annotation = record.data;

      // Filter out entries without meaningful content
      if (!annotation.EntryText && !annotation.HighlightText) {
        continue;
      }

      // Apply limit if specified
      if (this.shouldStopExtracting(count)) {
        break;
      }

      yield this.createRecord(annotation);
      count++;
    }
  }
}
