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

  protected override postTransform(result: BaseAndChildren, record: Record): void {
    // The observed axis is total: every payload leaves the transformer carrying a
    // `@assertedAt`, so ingest never has to fall back to a wall-clock stamp. Which
    // instant depends on the source's temporality — the sighting axis, decided by
    // AXIS, never per-field. An explicit `@assertedAt` already on the payload
    // always wins in both branches.
    const top = result as BaseAndChildren & {
      '@assertedAt'?: string | Date;
      timestamp?: string | Date;
      startTime?: string | Date;
      endTime?: string | Date;
    };
    if (record.extraction.temporality === 'snapshot') {
      // Snapshot: a re-read of CURRENT state. Stamp `@assertedAt` with the crawl's
      // "as of" time so mutable attributes (a renamed task, an updated bio) place
      // at observation time rather than back-dating to a creation/modification
      // event. The action's own historical timestamp is untouched, so it keeps its
      // true place on the timeline (via occurred_at).
      if (record.extraction.assertedAt && top['@assertedAt'] === undefined) {
        top['@assertedAt'] = record.extraction.assertedAt;
      }
    } else if (top['@assertedAt'] === undefined) {
      // Event: a discrete past event whose own timestamp IS when it was witnessed
      // (a message, a play, a like). Stamp `@assertedAt` from the occurrence so the
      // observed axis is honest and STABLE — otherwise ingest would date it
      // implicit-now (wall-clock) and a re-extraction of the same event would mint
      // a fresh sighting. Precedence mirrors the retired ingest fallback, so
      // event-native plugins are behavior-preserving. An occurrence-less event
      // node carries none and is correctly sighted implicit-now at ingest.
      const occurrence = top.timestamp ?? top.startTime ?? top.endTime;
      if (occurrence !== undefined) top['@assertedAt'] = occurrence;
    }
    BaseAndChildrenSchema.parse(result);
  }
}
