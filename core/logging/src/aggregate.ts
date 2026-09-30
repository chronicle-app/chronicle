import type { OutputEvent } from './types.js';

/** Distinct values tracked per field in a group, so memory stays bounded. */
const MAX_VALUES = 50;
const MAX_VALUE_LENGTH = 60;

/** Counts of each value a field took, and how many values went untracked. */
export type ValueCounts = Record<string, number>;

export interface AggregatorOptions {
  /** Events shown per group before the rest are counted. Default 3. */
  examples?: number;
  /** Most often a group's roll-up prints, in milliseconds. Default 5s. */
  windowMs?: number;
  /** The same for warnings and errors, which shouldn't wait as long. Default 1s. */
  urgentWindowMs?: number;
}

interface Group {
  key: string;
  shown: number;
  /** Counted since the last roll-up. */
  pending: number;
  last: OutputEvent;
  /** When the last roll-up (or the first event) printed. */
  since: number;
  values: Map<string, Map<string, number>>;
  personal: Set<string>;
}

/** Kinds that repeat per record, and so group without being asked. */
const GROUPABLE = new Set(['notice', 'diagnostic', 'error']);

/**
 * The group an event belongs to: its `key`, else its scope and message with
 * the numbers taken out. Personal values belong in fields, so a message is
 * already close to a template: `Generated 1 actions` and `Generated 3
 * actions` group together.
 */
export function groupOf(event: OutputEvent): string | undefined {
  if (event.key) return event.key;
  if (!GROUPABLE.has(event.kind)) return undefined;
  return `${event.scope}\u0000${event.message.replaceAll(/\d+/g, '#')}`;
}

const text = (value: unknown) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH - 1)}…` : s;
};

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

/**
 * Keeps repeated events from flooding: each group shows its first few
 * events, then counts the rest and reports them as a roll-up at most once a
 * window, with how often each field value came up. 10,000 failed records
 * become three examples and a line every second or so, not 10,000 lines.
 */
export class Aggregator {
  private groups = new Map<string, Group>();
  private readonly examples: number;
  private readonly windowMs: number;
  private readonly urgentWindowMs: number;

  constructor(options: AggregatorOptions | number = {}) {
    const o = typeof options === 'number' ? { examples: options } : options;
    this.examples = o.examples ?? 3;
    this.windowMs = o.windowMs ?? 5000;
    this.urgentWindowMs = o.urgentWindowMs ?? 1000;
  }

  /** What to print now for this event: roll-ups that came due, then the event if it shows. */
  admit(event: OutputEvent): OutputEvent[] {
    const now = event.time.getTime();
    const out = this.due(now);
    const key = groupOf(event);
    if (!key) return [...out, event];
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        shown: 0,
        pending: 0,
        last: event,
        since: now,
        values: new Map(),
        personal: new Set(),
      };
      this.groups.set(key, group);
    }
    group.last = event;
    if (group.shown < this.examples) {
      group.shown++;
      group.since = now;
      out.push(event);
      return out;
    }
    group.pending++;
    this.count(group, event);
    return out;
  }

  /** Every pending roll-up, now: for a summary, a flush, or exit. */
  drain(): OutputEvent[] {
    const out: OutputEvent[] = [];
    for (const group of this.groups.values()) {
      if (group.pending > 0) out.push(this.rollup(group, group.last.time.getTime(), true));
    }
    this.groups.clear();
    return out;
  }

  /** Whether any group is holding events back. */
  get pending(): boolean {
    for (const group of this.groups.values()) if (group.pending > 0) return true;
    return false;
  }

  /** Roll-ups whose window has passed by `now`. */
  due(now: number): OutputEvent[] {
    const out: OutputEvent[] = [];
    for (const group of this.groups.values()) {
      const urgent = group.last.level === 'warn' || group.last.level === 'error';
      const window = urgent ? this.urgentWindowMs : this.windowMs;
      if (group.pending > 0 && now - group.since >= window) out.push(this.rollup(group, now));
    }
    return out;
  }

  private count(group: Group, event: OutputEvent): void {
    for (const [field, value] of Object.entries(event.fields ?? {})) {
      if (value === undefined || value === null || typeof value === 'object') continue;
      if (event.sensitive?.includes(field)) group.personal.add(field);
      const counts = group.values.get(field) ?? new Map<string, number>();
      const label = text(value);
      if (counts.has(label) || counts.size < MAX_VALUES) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      } else {
        counts.set('…', (counts.get('…') ?? 0) + 1);
      }
      group.values.set(field, counts);
    }
  }

  private rollup(group: Group, now: number, final = false): OutputEvent {
    const { last, pending } = group;
    const values: Record<string, ValueCounts> = {};
    const personal: Record<string, ValueCounts> = {};
    for (const [field, counts] of group.values) {
      (group.personal.has(field) ? personal : values)[field] = Object.fromEntries(counts);
    }
    const count = pending.toLocaleString('en-US');
    const event: OutputEvent = {
      time: new Date(now),
      level: last.level,
      kind: last.kind,
      scope: last.scope,
      ...(last.run && { run: last.run }),
      message: final
        ? `…and ${count} more like this`
        : `…${count} more like this in ${seconds(now - group.since)}`,
      fields: {
        suppressed: pending,
        windowMs: now - group.since,
        ...(Object.keys(values).length > 0 && { values }),
        ...(Object.keys(personal).length > 0 && { personal }),
      },
      ...(Object.keys(personal).length > 0 && { sensitive: ['personal'] }),
      key: group.key,
    };
    group.pending = 0;
    group.since = now;
    group.values.clear();
    group.personal.clear();
    return event;
  }
}
