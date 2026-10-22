import { sha256 } from '@noble/hashes/sha2.js';
import type { KeyField } from './schema.js';

/**
 * A node's identity as one string, whatever its source or the shape of its
 * `@key`: the hash of its keyset, the values of the fields its `@key` names.
 * Extractors and stores derive it the same way, so one node can name another
 * by it, such as from its text, without knowing how the other is keyed. The
 * hash must never change: every stored identity is one.
 */

/** A node, as far as its identity goes: its `@key` or `@id`, and the fields they name. */
export interface KeyedNode {
  '@type'?: unknown;
  '@key'?: KeyField[];
  '@id'?: unknown;
}

/**
 * The source a node identified by nothing but its URL belongs to. A URL is a
 * portable identifier, like an email address or a phone number, so it belongs
 * to no product, whichever source saw it.
 */
export const URL_SOURCE = 'url';

/**
 * Deep, recursive, stable-key canonicalization: object keys are sorted at
 * every level and undefined values dropped, so equal content always produces
 * identical bytes. Array order is kept, since it means something. A `Date` is
 * the ISO string a store gets for it, once it's serialized.
 */
export function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(v => canonicalize(v));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = canonicalize(source[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/** Canonical JSON: the same string whatever order the keys were added in. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Lowercase base32 (RFC 4648, no padding) of the sha256 of the bytes: 52
 * characters, shorter than hex and safe in URLs and on case-insensitive
 * filesystems.
 */
export function base32Sha256(bytes: Uint8Array): string {
  const bits = Array.from(sha256(bytes), byte => byte.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

/**
 * The hash of a keyset: the base32 sha256 of its canonical JSON, the same
 * however its keys are ordered.
 */
export function generateKeysetCID(keyset: Record<string, unknown>): string {
  // An empty keyset would hash to one key shared by every record that has one.
  if (Object.keys(keyset).length === 0) {
    throw new Error('Cannot compute a content key for an empty object — it carries no identity.');
  }
  return base32Sha256(new TextEncoder().encode(canonicalJson(keyset)));
}

/**
 * The keyset a node's `@key` names: each field's value by its path, with dots
 * and `[*]` splats followed into nested values and a list joined with commas.
 * `source` is the source given, and an `action.` field is read from the action
 * the node is in. A computed entry `{ key, value }` is `key:value`. Fields
 * with no value are left out, and a keyset with none is null, so it never
 * names one node shared by unrelated records. A key of nothing but `url` is
 * the `url` source's, so it names the same node whichever source saw it.
 */
export function keysetOf(
  node: KeyedNode,
  source: string | undefined,
  actionContext?: Record<string, unknown>
): Record<string, unknown> | null {
  const keyFields = node['@key'];
  if (!keyFields || keyFields.length === 0) return null;
  const keyset: Record<string, unknown> = {};
  for (const field of keyFields) {
    if (typeof field === 'string') {
      if (field.startsWith('action.') && actionContext) {
        const value = extractNestedValue(actionContext, field.slice(7));
        if (value !== undefined && value !== null) keyset[field] = value;
      } else {
        const value = field === 'source' ? source : extractNestedValue(node, field);
        if (value !== undefined && value !== null) {
          keyset[field] = Array.isArray(value) ? value.join(',') : value;
        }
      }
    } else if (typeof field === 'object' && field.key && field.value !== undefined) {
      keyset[`${field.key}:${field.value}`] = field.value;
    }
  }
  if (Object.keys(keyset).length === 0) return null;
  if (Object.keys(keyset).length === 1 && typeof keyset.url === 'string') {
    return { source: URL_SOURCE, url: keyset.url };
  }
  return keyset;
}

/**
 * A node's identity: the hash of the keyset its `@key` names, or its `@id`,
 * which is that hash already. With both, they must agree. With neither, it's
 * its `url`, as the `url` source's, or else its `attachmentCid`, the stored
 * file it is. `source` is the node's own unless given, as for a node in a
 * record of that source that names none.
 */
export function nodeKey(
  node: KeyedNode,
  source: string | undefined = fieldOf(node, 'source'),
  actionContext?: Record<string, unknown>
): string {
  const keyset = keysetOf(node, source, actionContext);
  const derived = keyset ? generateKeysetCID(keyset) : undefined;
  const id = typeof node['@id'] === 'string' && node['@id'] ? node['@id'] : undefined;
  if (id && derived && id !== derived) {
    throw new Error(
      `Entity @id (${id}) does not match the hash of its @key keyset (${derived}). ` +
        `Entity type: ${String(node['@type'] ?? 'unknown')}, source: ${source}`
    );
  }
  const fallback = (field: string, keyset: (value: string) => Record<string, unknown>) => {
    const value = fieldOf(node, field);
    return value ? generateKeysetCID(keyset(value)) : undefined;
  };
  const key =
    id ??
    derived ??
    fallback('url', url => ({ source: URL_SOURCE, url })) ??
    fallback('attachmentCid', attachmentCid => ({ attachmentCid }));
  if (!key) {
    throw new Error(
      `Entity carries neither @key nor @id — no usable identity. Entity type: ${String(
        node['@type'] ?? 'unknown'
      )}, source: ${source}`
    );
  }
  return key;
}

/** A node's field, when it's a string. */
function fieldOf(node: KeyedNode, field: string): string | undefined {
  const value = (node as { [field: string]: unknown })[field];
  return typeof value === 'string' ? value : undefined;
}

function extractNestedValue(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.includes('[*]')) {
      const arrayProp = part.replace('[*]', '');
      if (current && typeof current === 'object' && arrayProp in current) {
        const arrayValue = current[arrayProp];
        if (Array.isArray(arrayValue)) {
          const remainingPath = parts.slice(i + 1).join('.');
          if (remainingPath) {
            return arrayValue
              .map(item => extractNestedValue(item, remainingPath))
              .filter(val => val !== undefined);
          }
          return arrayValue;
        }
        return undefined;
      }
      return undefined;
    }
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}
