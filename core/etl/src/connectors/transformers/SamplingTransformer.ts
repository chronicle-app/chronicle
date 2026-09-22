import { Record } from '../../types.js';
import { Transformer } from '../../transformer.js';

export class SamplingTransformer extends Transformer {
  static override description: string =
    'Sample records at a specified rate using probabilistic sampling';

  async transform(record: Record) {
    // Probabilistic sampling - each record has independent chance
    const shouldInclude = Math.random() < this.config.rate;

    if (shouldInclude) {
      return [record.data];
    }

    return [];
  }
}
