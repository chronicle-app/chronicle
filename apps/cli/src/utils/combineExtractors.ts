import { Extractor, type Record } from '@chronicle.app/etl';
import type { ExtractorMetadata } from '../plugins/PluginScanner.js';

type ExtractorClass = typeof Extractor & { [key: string]: any };

/** Whether every extractor can say when its records happened, so they can merge. */
export function canMerge(chosen: ExtractorMetadata[]): boolean {
  return chosen.every(c => typeof (c.extractor.prototype as any)?.occurredAt === 'function');
}

/**
 * One extractor for record kinds that separate extractors of one strategy
 * read, so `extract github stars gists` runs as one. When every extractor
 * says when its records happened (`occurredAt`), their streams merge newest
 * first and `--limit` keeps the most recent across them; otherwise they run
 * one after another.
 */
export function combineExtractors(chosen: ExtractorMetadata[]): ExtractorClass {
  const children = chosen.map(c => c.extractor as ExtractorClass);
  const [first] = children;
  const merge = canMerge(chosen);
  let schema = Extractor.schema as typeof Extractor.schema;
  for (const child of children) schema = schema.merge(child.schema);

  return class CombinedExtractor extends Extractor<any> {
    static override source = first.source;
    static override strategy = first.strategy;
    static override delivery = first.delivery;
    static override recordTypes = [...new Set(chosen.flatMap(c => c.recordType))];
    static override defaultTransformer = first.defaultTransformer;
    // The flags of every child, so the CLI hands each its own.
    static override schema = schema;

    private readonly rawConfig: any;
    private instances: Extractor[] = [];

    constructor(config: any) {
      super(config);
      this.rawConfig = config;
    }

    override async setup(): Promise<void> {
      // Children share the raw config, so a plugin can share a session across them.
      this.instances = children.map(Child => new (Child as any)(this.rawConfig));
      for (const instance of this.instances) await instance.setup();
    }

    private childFor(record: Record): Extractor | undefined {
      return this.instances.find(instance =>
        ((instance.constructor as typeof Extractor).recordTypes ?? []).includes(
          record.extraction.recordType ?? ''
        )
      );
    }

    /** Each record's key, from the child that read its kind. */
    override keyOf(record: Record): string | null {
      return this.childFor(record)?.keyOf?.(record) ?? null;
    }

    override occurredAt(record: Record): Date | undefined {
      return this.childFor(record)?.occurredAt?.(record);
    }

    async *extract(): AsyncGenerator<Record> {
      const limit = this.getEffectiveLimit();
      let count = 0;
      // Typed as AsyncIterator (not Generator) so `.return?.()` needs no argument.
      const streams: AsyncIterator<Record>[] = this.instances.map(instance =>
        instance.performExtract()
      );
      try {
        if (!merge) {
          for (const stream of streams) {
            for await (const record of { [Symbol.asyncIterator]: () => stream }) {
              if (limit !== null && count >= limit) return;
              yield record;
              count++;
            }
          }
          return;
        }
        // Newest first across children: always the most recent next record.
        const time = (record: Record) =>
          this.childFor(record)?.occurredAt?.(record)?.getTime() ?? Number.NEGATIVE_INFINITY;
        const heads = await Promise.all(streams.map(stream => stream.next()));
        for (;;) {
          if (limit !== null && count >= limit) return;
          let best = -1;
          for (let i = 0; i < heads.length; i++) {
            if (heads[i].done) continue;
            if (best === -1 || time(heads[i].value) > time(heads[best].value)) best = i;
          }
          if (best === -1) return;
          yield heads[best].value;
          count++;
          heads[best] = await streams[best].next();
        }
      } finally {
        await Promise.all(streams.map(stream => stream.return?.()));
      }
    }

    override async teardown(): Promise<void> {
      for (const instance of this.instances) await instance.teardown();
    }
  } as unknown as ExtractorClass;
}
