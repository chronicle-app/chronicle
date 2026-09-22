import { Transformer } from './transformer.js';
import { Record } from './types.js';
import { BaseAndChildren, BaseAndChildrenSchema } from '@chronicle.app/schema';

// A subclass of Transformer that always outputs valid Chronicle Schema
export abstract class ChronicleTransformer extends Transformer {
  static override outputSchema: string = 'chronicle';

  protected abstract override transform(record: Record): Promise<BaseAndChildren[]>;

  protected override recordToString(record: Record): string {
    const obj = record.data as BaseAndChildren;
    const parts = [record.extraction.source, obj['@type'], obj.sourceId];
    return parts.filter(Boolean).join('.');
  }

  protected override postTransform(result: BaseAndChildren, _record: Record): void {
    BaseAndChildrenSchema.parse(result);
  }
}
