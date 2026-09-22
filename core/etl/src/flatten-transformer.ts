import { flatten } from 'flat';

import { Record } from './types.js';
import { Transformer } from './transformer.js';

export class FlattenTransformer extends Transformer {
  static override outputSchema: string = 'raw';

  async transform(record: Record) {
    const newData = flatten(record.data, { safe: false });

    return [newData];
  }
}
