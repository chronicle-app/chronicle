import { Extractor } from './extractor.js';
import { Record } from './types.js';

/** A constructable Extractor class (the abstract base is not `new`-able). */
type ExtractorCtor = new (config: any) => Extractor;

/**
 * The reverse-chronological "default" view of a multi-extractor source: merges
 * several child extractors' newest-first streams into one globally newest-first
 * stream, applying `--limit` to the MERGED output. So `-l 1` yields the single
 * most-recent record across all children (not one per child).
 *
 * Convention for a multi-extractor source: the focused extractors stay
 * `default: false`; one `MergingExtractor` subclass with `default: true` lists
 * the CURATED subset to merge in `children`. Niche extractors are simply left
 * out of `children` — they stay reachable only by asking for their record kinds
 * with `--type` and never run by default. Pair with a `DispatchingTransformer`
 * that routes each child's records to that child's own transformer.
 *
 * Contract each child must honor: `extract()` yields records newest-first, and
 * the subclass's `sortKey(record)` returns a comparable occurrence value
 * (higher = more recent) for every record type the children emit. The subclass
 * also declares its own `delivery` — composition is not a way in, so a merge
 * inherits nothing here and states how its children reach us.
 */
export abstract class MergingExtractor<
  SelfClass extends typeof Extractor = typeof Extractor,
> extends Extractor<SelfClass> {
  /** The curated set of child extractor classes to merge, in any order. */
  static children: ExtractorCtor[] = [];

  /** The raw (unparsed) config, forwarded verbatim to each child. */
  protected readonly rawConfig: any;
  private instances: Extractor[] = [];

  constructor(config: any) {
    super(config);
    this.rawConfig = config;
  }

  /** Occurrence key used to order the merge; higher sorts earlier (newest-first). */
  protected abstract sortKey(record: Record): number;

  private childClasses(): ExtractorCtor[] {
    return (this.constructor as unknown as typeof MergingExtractor).children;
  }

  override async setup(): Promise<void> {
    // Children re-parse the raw config for their own flags (input, since, …).
    // They may receive `limit` as an upper bound — the global top-K never needs
    // more than K records from any single child.
    this.instances = this.childClasses().map(Child => new Child(this.rawConfig));
    await Promise.all(this.instances.map(c => c.setup()));
  }

  /**
   * Route to the child that produced this record's (source, recordType); a
   * child without its own keyOf contributes no keys, exactly as when it runs
   * alone.
   */
  override keyOf(record: Record): string | null {
    for (const child of this.instances) {
      const cls = child.constructor as typeof Extractor;
      if (
        cls.source === record.extraction.source &&
        (cls.recordTypes ?? []).includes(record.extraction.recordType ?? '')
      ) {
        return child.keyOf?.(record) ?? null;
      }
    }
    return null;
  }

  async *extract(): AsyncGenerator<Record> {
    // Typed as AsyncIterator (not Generator) so `.return?.()` needs no argument.
    // performExtract (not extract) so each child stream carries its own
    // frontier cursor when the child opted in.
    const iterators: AsyncIterator<Record>[] = this.instances.map(c => c.performExtract());
    // The current head record of each child (its next-newest), or done.
    const heads = await Promise.all(iterators.map(it => it.next()));
    const limit = this.getEffectiveLimit();

    let count = 0;
    try {
      for (;;) {
        if (limit !== null && count >= limit) break;
        // Pick the live child whose head record is the most recent.
        let best = -1;
        for (let i = 0; i < heads.length; i++) {
          const head = heads[i];
          if (head.done) continue;
          if (best === -1 || this.sortKey(head.value) > this.sortKey(heads[best].value)) {
            best = i;
          }
        }
        if (best === -1) break; // every child exhausted
        yield heads[best].value;
        count++;
        heads[best] = await iterators[best].next();
      }
    } finally {
      // Release any child cursors we stopped short of draining.
      await Promise.all(iterators.map(it => it.return?.()));
    }
  }

  override async determineCount(): Promise<number | null> {
    const counts = await Promise.all(this.instances.map(c => c.determineCount()));
    if (counts.includes(null)) return null;
    const total = counts.reduce((sum: number, c) => sum + (c ?? 0), 0);
    const limit = this.getEffectiveLimit();
    return limit === null ? total : Math.min(limit, total);
  }

  override async teardown(): Promise<void> {
    await Promise.all(this.instances.map(c => c.teardown()));
  }
}
