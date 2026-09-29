import type { OutputEvent } from './types.js';

/**
 * Keyed events past the first few are counted instead of shown: 10,000
 * failed records become three examples and `…and 9,997 more like this`.
 */
export class Aggregator {
  private seen = new Map<string, { last: OutputEvent; count: number }>();

  constructor(private readonly examples = 3) {}

  /** Whether to show this event; keyless events always show. */
  admit(event: OutputEvent): boolean {
    if (!event.key) return true;
    const entry = this.seen.get(event.key) ?? { last: event, count: 0 };
    entry.count++;
    entry.last = event;
    this.seen.set(event.key, entry);
    return entry.count <= this.examples;
  }

  /** One event per key that held some back, then a clean slate. */
  drain(): OutputEvent[] {
    const out: OutputEvent[] = [];
    for (const [key, { last, count }] of this.seen) {
      const more = count - this.examples;
      if (more <= 0) continue;
      out.push({
        time: last.time,
        level: last.level,
        kind: last.kind,
        scope: last.scope,
        ...(last.run && { run: last.run }),
        message: `…and ${more.toLocaleString('en-US')} more like this`,
        fields: { suppressed: more },
        key,
      });
    }
    this.seen.clear();
    return out;
  }
}
