import * as json from 'multiformats/codecs/json';
import type { KeyField } from '@chronicle.app/schema';
import { getIdentityEdgePredicates } from '../annotations/ontology.js';
import { PERSISTENCE_NAMESPACE } from '../constants.js';
import { base32Sha256, canonicalize } from './canonical.js';

/**
 * A node's resolved identity: the content key that indexes it, plus the keyset
 * preimage the key hashes — or `null` when identity arrived pre-derived as a
 * bare `@id`. `@id` and `@key` are two spellings of the same identity: `@key`
 * names the fields whose values form the keyset (which we hash), `@id` supplies
 * that hash directly. Everything downstream (dedup, merge, event `target_key`)
 * operates on `key` alone; `keyset` is preimage-only, kept for handle/url
 * display and null-tolerated everywhere it is read.
 */
export interface EntityIdentity {
  key: string;
  keyset: Record<string, unknown> | null;
}

/**
 * Normalize a wire `@id` to the bare content key. Serializers emit content IRIs
 * (`<{PERSISTENCE_NAMESPACE}entity/{key}>`, `<...action/{key}>`), not bare
 * hashes; accept those and the bare key so serializer output round-trips
 * unmodified. Nothing else is a valid `@id` — the value is always the canonical
 * keyset hash (`generateKeysetCID`), bit-identical to what the origin derived.
 */
function normalizeContentId(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  for (const kind of ['entity/', 'action/']) {
    const prefix = `${PERSISTENCE_NAMESPACE}${kind}`;
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  return s;
}

/**
 * Content key over a keyset/identity object: bare base32 sha256 of its canonical
 * JSON (see `base32Sha256` / `valueKey` in `canonical.ts` for the encoding).
 * Computed synchronously so the fold can mint keys inside the synchronous
 * SQLite transaction. Deep canonicalization makes the key identical
 * regardless of key order; the JSON encoding matches `valueKey`, so keysets and
 * literal values share one content-key space.
 *
 * Event-body and attachment content addresses stay CIDs (`assertionCid.ts`,
 * `BlobStore.ts`) — those are the genuinely content-addressed payloads.
 */
function contentKey(value: Record<string, unknown>): string {
  // An empty object hashes to one fixed key, so any caller that reaches here
  // with `{}` would silently collapse unrelated records onto a shared key.
  // Reject it at the shared chokepoint so every path (keyset, action dedupe,
  // entity) is covered, not just `generateSourcedEntityCID`.
  if (Object.keys(value).length === 0) {
    throw new Error('Cannot compute a content key for an empty object — it carries no identity.');
  }
  return base32Sha256(json.encode(canonicalize(value) as Record<string, unknown>));
}

/** Content key for a sourced-entity snapshot. */
export function generateSourcedEntityCID(data: Record<string, unknown>): string {
  const keys = Object.keys(data).filter(k => k !== '@key');
  if (keys.length === 0) {
    throw new Error(
      'Cannot generate a content key from an empty keyset. Keyset must contain at least one field to carry identity.'
    );
  }
  return contentKey(data);
}

/** Content key for an action dedupe keyset. */
export function generateActionDedupeCID(keyset: Record<string, unknown>): string {
  return contentKey(keyset);
}

// Roles whose participant identity makes a synthetic action distinct. `location`
// is excluded — it is a value, not an entity, and an action's identity is the
// activity between its agent/object, not where it happened.
const SYNTHETIC_ROLE_KEYS = ['agent', 'object', 'result', 'instrument', 'target'] as const;

/**
 * Identity keyset for a SYNTHETIC action — one the fold materialises because a
 * lifecycle/reaction fact has no backing source event (a reading list that only
 * says "finished Dune in 2019"). The key derives from the run's
 * logical identity — the action type plus its resolved participants — never a
 * fabricated id, so two sources asserting the same fact coalesce onto one row
 * and re-imports are no-ops.
 *
 * Pure and payload-only: each role's key is the content hash of that role node's
 * OWN keyset, identical whether computed at ingest (for `events.target_key`) or
 * at shred (for `actions.key`), and stable under entity merges (the sourced key
 * never moves, only its `entity_id` cache does). The first entity node per role
 * wins, mirroring the shred role loop.
 */
export function syntheticActionKeyset(
  body: Record<string, unknown>,
  source: string
): Record<string, unknown> {
  // `@synthetic: true` is the namespace marker (same boolean meaning as on the
  // payload, via isSyntheticAction) so a synthetic key never collides with a
  // real action whose `@key` happens to enumerate the same fields; `@type`
  // carries the action type that, with the participants below, IS the identity.
  const keyset: Record<string, unknown> = {
    '@synthetic': true,
    '@type': String(body['@type']),
  };
  for (const role of SYNTHETIC_ROLE_KEYS) {
    const raw = body[role];
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (!isEntityNode(item)) continue;
      const refSource = typeof item.source === 'string' ? item.source : source;
      // A role node may carry `@id` instead of `@key`; its identity is the
      // content key either way, so take the primary identity's key directly.
      keyset[role] = extractEntityIdentities(item, refSource)[0].key;
      break;
    }
  }
  return keyset;
}

/** Whether a payload declares itself a synthetic (fold-materialised) action. */
export function isSyntheticAction(body: Record<string, unknown>): boolean {
  return body['@synthetic'] === true;
}

/**
 * Content key for a single keyset (no type), used as the `key` column on
 * `sourced_entities` (the key->entity index) and `actions`. A keyset hash is
 * stable across amendments and identical regardless of key order.
 */
export function generateKeysetCID(keyset: Record<string, unknown>): string {
  return contentKey(keyset);
}

/** Content key for a harmonized entity identity (type + canonical keyset). */
export function generateEntityCID(type: string, canonicalData: Record<string, unknown>): string {
  return contentKey({ type, ...canonicalData });
}

function isEntityNode(v: any): v is Record<string, any> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v['@type'] === 'string';
}

/**
 * The namespace a URL-identified entity belongs to. A URL is a portable,
 * standard identifier — the same class as `email`, `phone`, `domain`, `did`,
 * `isbn` — so by the source-naming rule (portable id → protocol source, never a
 * product) the identity belongs to the `url` namespace, not to whichever browser
 * or importer happened to witness it. The witnessing record keeps its own source
 * on its own row; the url identity is shared and belongs to no product.
 *
 * Exported so plugins and direct sources can author the same shape a bare `url`
 * field auto-mints, and so the query side can filter on it.
 */
export const URL_SOURCE = 'url';

/**
 * The reserved self-hub keyset: the identity every `'@me'`-tagged agent node
 * merges onto, giving the account owner one stable entity across sources that
 * share no source-specific keyset (Goodreads numeric id, Slack `U0XXX`, phone
 * E.164). Internal to persistence — never exported to plugins, which only ever
 * author the `'@me'` token in a `sameAs` edge (see {@link SELF_REF}).
 *
 * `handle` (not `sourceId`) because nothing issued this id: there is no
 * `chronicle` source record, and a symbolic self-reference is a contextual
 * identifier. The full `["@type","source","handle"]` keyset matches every other
 * keyset and leaves room for future reserved `chronicle`-source singletons. Self
 * is always `Person`: because the hub type is injected here (not authored), a
 * carrier node of `@type: Agent` still merges into a `Person` hub.
 *
 * Exported so the query evaluator (`resolveSelf`) hashes this exact keyset — the
 * authoring side (here) and the query side MUST agree on it, or egocentric
 * queries silently resolve to nothing. Single source of truth, hence shared.
 */
export const SELF_HUB_KEYSET = {
  '@type': 'Person',
  source: 'chronicle',
  handle: 'myself',
} as const;

// The hub as an authorable node: the keyset plus the `@key` directive
// (exactly its fields) that ownIdentities turns back into SELF_HUB_KEYSET.
const SELF_HUB: Record<string, any> = {
  ...SELF_HUB_KEYSET,
  '@key': Object.keys(SELF_HUB_KEYSET),
};

// The reserved self-reference token. In a merge-edge slot (`sameAs`) it expands
// to the self hub, so `sameAs: ['@me']` is how a plugin tags the account owner.
// It mirrors the CQL `@me` value token, so authoring and querying share one
// spelling for the same identity.
export const SELF_REF = '@me';

/**
 * The identities a node carries itself — its `@key`/`@id` identity plus the
 * auto `{url}` identity when a string `url` is present.
 *
 * `@key` names the fields (string paths with dot and `[*]` splat, plus computed
 * `{key, value}` entries) whose values form the keyset preimage, which we hash.
 * `@id` supplies that hash directly (pre-derived). A node must carry at least
 * one — the "at least one" invariant, enforced fail-fast in the Zod schema and
 * backstopped here for the replication path (which skips Zod). When both are
 * present they must agree: the `@key` preimage's hash equals the `@id`, a cheap
 * integrity check.
 */
function ownIdentities(
  entityData: any,
  source: string,
  actionContext?: Record<string, any>
): EntityIdentity[] {
  const identities: EntityIdentity[] = [];
  const keyFields: KeyField[] | undefined = entityData['@key'];
  const rawId = entityData['@id'];
  const hasId = typeof rawId === 'string' && rawId.length > 0;

  // Build the `@key` preimage keyset (when @key is present). Only fields that
  // resolve to a real value contribute; an all-null keyset is left as null so
  // it never hashes to one shared CID and cross-links unrelated records.
  let keyKeyset: Record<string, any> | null = null;
  if (keyFields && keyFields.length > 0) {
    const keyset: Record<string, any> = {};
    for (const field of keyFields) {
      if (typeof field === 'string') {
        if (field.startsWith('action.') && actionContext) {
          const actionField = field.slice(7);
          const value = extractNestedValue(actionContext, actionField);
          if (value !== undefined && value !== null) keyset[field] = value;
        } else {
          let value: any;
          if (field === 'source') {
            value = source;
          } else {
            value = extractNestedValue(entityData, field);
          }
          if (value !== undefined && value !== null) {
            keyset[field] = Array.isArray(value) ? value.join(',') : value;
          }
        }
      } else if (typeof field === 'object' && field.key && field.value !== undefined) {
        keyset[`${field.key}:${field.value}`] = field.value;
      }
    }
    if (Object.keys(keyset).length > 0) keyKeyset = keyset;
    // `@key: ["url"]` is authored all over the plugins and means "identified by
    // nothing but this url" — which IS the `url` namespace identity. Normalize it
    // to the namespaced shape so it hashes to the same key as the auto-minted one
    // below, rather than minting a second, product-attributed row beside it.
    // A keyset that names its own source (`["url","source"]` on a bookmark) is a
    // source's own record and is left alone.
    if (keyKeyset && Object.keys(keyKeyset).length === 1 && typeof keyKeyset.url === 'string') {
      keyKeyset = { source: URL_SOURCE, url: keyKeyset.url };
    }
  }

  // Primary identity from `@id` and/or `@key`.
  if (hasId) {
    const id = normalizeContentId(rawId);
    if (keyKeyset) {
      // Both present: derive from `@key` and require equality with `@id`.
      const derived = generateKeysetCID(keyKeyset);
      if (derived !== id) {
        throw new Error(
          `Entity @id (${id}) does not match the hash of its @key keyset (${derived}). ` +
            `Entity type: ${entityData['@type'] || 'unknown'}, source: ${source}`
        );
      }
      identities.push({ key: derived, keyset: keyKeyset });
    } else {
      // `@id`-only: the hash is the identity; no preimage is stored.
      identities.push({ key: id, keyset: null });
    }
  } else if (keyKeyset) {
    identities.push({ key: generateKeysetCID(keyKeyset), keyset: keyKeyset });
  }

  // The auto `{url}` identity — supplementary, always a real preimage. Also the
  // fallback primary when `@key` fields all resolved to null and no `@id` given.
  if (entityData.url && typeof entityData.url === 'string') {
    const urlKeyset = { source: URL_SOURCE, url: entityData.url };
    identities.push({ key: generateKeysetCID(urlKeyset), keyset: urlKeyset });
  }

  // The auto `{attachmentCid}` identity: a content-addressed artifact IS
  // its bytes, so identical captures (a screenshot, an archived page, the same
  // image behind two URLs) dedupe by CID regardless of @type or source. The
  // contentData → attachmentCid rewrite runs before minting, so this sees the CID.
  if (entityData.attachmentCid && typeof entityData.attachmentCid === 'string') {
    const cidKeyset = { attachmentCid: entityData.attachmentCid };
    identities.push({ key: generateKeysetCID(cidKeyset), keyset: cidKeyset });
  }

  if (identities.length === 0) {
    throw new Error(
      `Entity carries neither @key nor @id — no usable identity. Entity type: ${
        entityData['@type'] || 'unknown'
      }, source: ${source}`
    );
  }

  return identities;
}

/**
 * Extract every candidate identity for an entity — the keys that drive
 * within-source dedup and cross-source merge. This is the node's own identities
 * (see {@link ownIdentities}) plus, for each ontology `identityEffect: merge`
 * edge (e.g. `sameAs`), the own identities of every referenced entity node. A
 * merge edge says "this reference is the same entity as me," so folding its
 * identity in here is exactly what makes the two sourced entities resolve to one
 * — the explicit, plugin-declared form of the auto `{url}` keyset. A merge ref
 * may itself be `@id`-only (its hash folds in directly). `cut` edges
 * (`differentFrom`) are not identity-bearing and are left out.
 */
export function extractEntityIdentities(
  entityData: any,
  source: string,
  actionContext?: Record<string, any>
): EntityIdentity[] {
  const identities = ownIdentities(entityData, source, actionContext);

  for (const predicate of getIdentityEdgePredicates().merge) {
    const raw = entityData[predicate];
    if (raw === undefined || raw === null) continue;
    for (const entry of Array.isArray(raw) ? raw : [raw]) {
      // `'@me'` is the reserved self-reference token: a merge edge onto the
      // self hub, the account owner's stable identity across sources that share
      // no source-specific keyset. It expands to the hub node and folds in
      // through the exact same union as a declared merge edge — no second
      // identity mechanism — so a node may carry both `'@me'` and a cross-source
      // `sameAs`, and both merges apply, order-independently. The query side
      // (`resolveSelf`) hashes the same SELF_HUB_KEYSET. A future anchor is
      // another reserved token here, not new machinery.
      const ref = entry === SELF_REF ? SELF_HUB : entry;
      if (!isEntityNode(ref)) continue; // a merge edge must reference a keyed entity
      const refSource = typeof ref.source === 'string' ? ref.source : source;
      identities.push(...ownIdentities(ref, refSource, actionContext));
    }
  }

  // One entry per distinct key, first occurrence winning — so `identities[0]`
  // stays the primary. A node can reach the same identity twice: a `@key:["url"]`
  // whose normalized keyset equals the auto-minted url identity, or a `sameAs`
  // ref that restates the node's own keyset. The fold deduped these downstream
  // anyway (`materializedAliases`, `INSERT OR IGNORE`); collapsing here keeps the
  // identity list an honest set.
  const seen = new Set<string>();
  return identities.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
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
