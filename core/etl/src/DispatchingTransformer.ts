import { Transformer } from './transformer.js';
import { Record } from './types.js';

/** A constructable Transformer class. */
type TransformerCtor = new (config?: any) => Transformer;

/**
 * Routes each record to a per-recordType transformer. This lets one extractor
 * that emits several record types (e.g. a `MergingExtractor`'s combined stream)
 * reuse the source's existing focused transformers unchanged, instead of
 * merging their logic into one switch.
 *
 * It delegates to each child's public `performTransform`, so every routed
 * transformer keeps its own output shape and `source` (a routed call transformer
 * keeps emitting its own source, etc.). A record whose type has no route yields
 * nothing.
 */
export abstract class DispatchingTransformer extends Transformer {
  /** recordType → the transformer that handles it. */
  static routes: { [recordType: string]: TransformerCtor } = {};

  private instances = new Map<string, Transformer>();

  private routeFor(recordType: string): Transformer | null {
    const { routes } = this.constructor as typeof DispatchingTransformer;
    const Child = routes[recordType];
    if (!Child) return null;
    let instance = this.instances.get(recordType);
    if (!instance) {
      instance = new Child(this.config);
      this.instances.set(recordType, instance);
    }
    return instance;
  }

  override async performTransform(record: Record): Promise<Record[]> {
    const { recordType } = record.extraction;
    const child = recordType ? this.routeFor(recordType) : null;
    return child ? child.performTransform(record) : [];
  }

  // Unused — `performTransform` is overridden to delegate — but the abstract
  // base still requires a `transform` implementation.
  protected async transform(_record: Record): Promise<any[]> {
    return [];
  }

  override async teardown(): Promise<void> {
    await Promise.all([...this.instances.values()].map(t => t.teardown()));
  }
}
