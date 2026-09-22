import { Record } from '../../types.js';
import { Transformer } from '../../transformer.js';

export class DelayTransformer extends Transformer {
  static override description: string =
    'Artificially delay the transformation of records by a specified number of milliseconds';

  async transform(record: Record) {
    await new Promise(resolve => setTimeout(resolve, this.config.delay || 1000));

    return [record.data];
  }
}
