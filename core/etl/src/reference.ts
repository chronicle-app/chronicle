import type { KeyField } from '@chronicle.app/schema';

interface Node {
  '@type': string;
  '@key'?: KeyField[];
  '@id'?: string;
  [field: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node)['@type'] === 'string';

/**
 * A node's identity alone: its `@type`, its `@key` or `@id`, and the fields
 * its key names. A node that appears again in one payload, such as the
 * account owner who is also the action's agent, carries this and nothing
 * else, and the fold merges it with the full node by its key. A nested node
 * a dotted key field names (`account.sourceId`) or a splat (`member[*].handle`)
 * is itself reduced to a reference. A computed entry and an `action.` field
 * are in the key already. Nothing else carries over, not even `sameAs`: the
 * full node elsewhere has it.
 */
export function reference<T extends { '@type': string }>(node: T): T {
  const full = node as unknown as Node;
  const out: Node = { '@type': full['@type'] };
  if (full['@key'] !== undefined) out['@key'] = full['@key'];
  if (full['@id'] !== undefined) out['@id'] = full['@id'];
  for (const field of full['@key'] ?? []) {
    if (typeof field !== 'string' || field.startsWith('@') || field.startsWith('action.')) continue;
    const [head] = field.split(/\.|\[\*\]/);
    if (!head || !(head in full) || head in out) continue;
    const value = full[head];
    if (isNode(value)) out[head] = reference(value);
    else if (Array.isArray(value))
      out[head] = value.map(item => (isNode(item) ? reference(item) : item));
    else out[head] = value;
  }
  return out as unknown as T;
}
