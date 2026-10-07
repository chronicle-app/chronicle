import { Transformer } from './transformer.js';
import { Record } from './types.js';
import { BaseAndChildren, BaseAndChildrenSchema, isInstant } from '@chronicle.app/schema';

/**
 * Mark every entity node in a payload as a complete snapshot of its predicates
 * by adding the `'*'` wildcard to its `@asserts` (preserving explicit entries).
 * Persistence expands `'*'` to the node's present cardinality-many predicates and
 * mints completeness markers, so a value that departed since the last snapshot
 * (a task moved out of a project) closes. Inert on nodes persistence doesn't
 * treat as observation subjects (the action itself, value nodes).
 */
function markComplete(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) markComplete(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as { [key: string]: unknown };
  if (typeof obj['@type'] === 'string') {
    const existing = Array.isArray(obj['@asserts'])
      ? (obj['@asserts'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (!existing.includes('*')) obj['@asserts'] = [...existing, '*'];
  }
  for (const value of Object.values(obj)) markComplete(value);
}

// A subclass of Transformer that always outputs valid Chronicle Schema
export abstract class ChronicleTransformer extends Transformer {
  static override outputSchema: string = 'chronicle';

  protected abstract override transform(record: Record): Promise<BaseAndChildren[]>;

  protected override recordToString(record: Record): string {
    const obj = record.data as BaseAndChildren;
    const objWithTimestamp = obj as any;
    const timestampValue =
      objWithTimestamp?.endTime ?? objWithTimestamp?.startTime ?? objWithTimestamp?.timestamp;
    let timestampString = '';

    if (timestampValue) {
      try {
        timestampString = new Date(timestampValue).toISOString();
      } catch {
        timestampString = new Date().toISOString();
      }
    }

    const parts = [obj.source, obj['@type'], timestampString];
    return parts.filter(Boolean).join('.');
  }

  protected override postTransform(result: BaseAndChildren, record: Record): void {
    // The observed axis is total: every payload leaves the transformer carrying a
    // `@assertedAt`, so ingest never has to fall back to a wall-clock stamp. Which
    // instant depends on the source's temporality — the sighting axis, decided by
    // AXIS, never per-field. An explicit `@assertedAt` already on the payload
    // always wins in both branches, and an extractor that knows when the source
    // observed the record (`extraction.recordAssertedAt`) beats both defaults.
    const top = result as BaseAndChildren & {
      '@assertedAt'?: string | Date;
      timestamp?: string | Date;
      startTime?: string | Date;
      endTime?: string | Date;
    };
    if (top['@assertedAt'] === undefined && record.extraction.recordAssertedAt) {
      // The extractor knew when the source observed this record, which beats
      // either default below.
      top['@assertedAt'] = record.extraction.recordAssertedAt;
    } else if (record.extraction.temporality === 'snapshot') {
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
      // node carries none and is correctly sighted implicit-now at ingest, as is
      // one dated only partly (`1987?`, `XXXX-03-12`): an observation is an
      // instant, and a date names none.
      const occurrence = top.timestamp ?? top.startTime ?? top.endTime;
      if (occurrence instanceof Date || (typeof occurrence === 'string' && isInstant(occurrence)))
        top['@assertedAt'] = occurrence;
    }
    if (record.extraction.temporality === 'snapshot') {
      // Completeness axis: a state re-read enumerates the whole set, so every
      // entity node asserts `'*'` — closing cardinality-many values that
      // departed since the last snapshot.
      markComplete(result);
    }
    BaseAndChildrenSchema.parse(result);
  }
}
