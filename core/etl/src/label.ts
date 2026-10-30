import type { RecordLabel } from '@chronicle.app/logging';
import { isInstant } from '@chronicle.app/schema';
import { nodeLabel } from './connectors/loaders/columns.js';
import type { Record } from './types.js';

const isNode = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text on one line, or nothing when there's none. */
const oneLine = (text: string | undefined) => text?.replaceAll(/\s+/g, ' ').trim() || undefined;

/** What names raw data: its first naming property, else the first text it carries. */
function titleIn(data: unknown): string | undefined {
  if (!isNode(data)) return undefined;
  return oneLine(
    nodeLabel(data) ?? Object.values(data).find((v): v is string => typeof v === 'string')
  );
}

/** A date for a label: an instant in ISO 8601, a partial date as written. */
function dateText(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== 'string' || value === '') return undefined;
  return isInstant(value) ? new Date(value).toISOString() : value;
}

/**
 * A Chronicle payload's label: its `@type`, what names it, and when it
 * happened (`timestamp`, else `startTime`, else `endTime`, as ingest places
 * it), each from the label it came with when the payload doesn't say.
 */
export function chronicleLabel(data: unknown, from?: RecordLabel): RecordLabel {
  const node = isNode(data) ? data : {};
  const type = typeof node['@type'] === 'string' ? node['@type'] : from?.type;
  const title = oneLine(nodeLabel(node)) ?? from?.title;
  const date = dateText(node.timestamp ?? node.startTime ?? node.endTime) ?? from?.date;
  return { type: type ?? 'records', ...(title && { title }), ...(date && { date }) };
}

/**
 * A raw record's label: its record type, what names it (`title`, else what
 * names its data), and when it happened.
 */
export function extractedLabel(record: Record, title?: string, occurred?: Date): RecordLabel {
  const named = oneLine(title) ?? titleIn(record.data);
  const date = dateText(occurred);
  return {
    type: record.extraction.recordType ?? 'records',
    ...(named && { title: named }),
    ...(date && { date }),
  };
}

/** A record's label, or one made from its data when it came without. */
export const recordLabel = (record: Record): RecordLabel => record.label ?? extractedLabel(record);
