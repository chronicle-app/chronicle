import { Record } from './types.js';
import { Transformer } from './transformer.js';

export class NullTransformer extends Transformer {
  async transform(record: Record) {
    return [record.data];
  }
}
