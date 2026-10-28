import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { chunked } from './entityIris.js';
import { entityUrls } from './keyset.js';

/**
 * How a representative image is found for an entity, shared by the action and
 * entity serializers so a page's thumbnail is the same picture wherever it is
 * shown. Three sources, in the order `imageRefFor` prefers them:
 *
 *   1. a downloaded blob on the entity or one hop away (`resolveImageAttachments`)
 *   2. a referenced image URL nothing downloaded (`resolveImageUrls`)
 *   3. LAST resort, the reverse `snapshotOf` edge (`resolveSnapshotImages`) — a
 *      browsed page carries no image of its own, but a screenshot is a snapshot
 *      OF it, so its latest shot stands in.
 *
 * A curated `emblem`/`depiction` therefore always beats a screenshot.
 */

/**
 * A representative image: either a stored blob (fetched through
 * `/attachment/:cid`) or a directly-loadable remote URL (an image the source
 * referenced but did not download, e.g. CDN album art).
 */
export type ActionImageRef =
  | {
      /** Content-addressed id of the image blob (CIDv1, raw codec). */
      cid: string;
      /** Authoritative MIME type from the attachments table; always `image/*`. */
      mimeType: string;
    }
  | { url: string };

/** Representative-image rank: emblem (chosen) outranks depiction (witnessed), then the rest. */
function rankOf(predicate: string): number {
  return predicate === 'emblem' ? 2 : predicate === 'depiction' ? 1 : 0;
}

/**
 * A referenced image URL for each subject that links an `ImageObject` (whose
 * displayable URL lives in its keyset). Edge-agnostic, like its blob twin
 * `resolveImageAttachments`: the representative image can be reached via an
 * `emblem` (the chosen representative — avatar/cover/logo), a `depiction` (a
 * witnessed photo of the thing), or `contains` (a post's own photo), so the
 * child is chosen by @type (`ImageObject`), not by a fixed predicate. When a
 * subject links several, `emblem` wins, then `depiction`, then lowest id for
 * determinism. Used when nothing was downloaded.
 */
export function resolveImageUrls(db: Db, subjectIds: number[]): Map<number, string> {
  const result = new Map<number, string>();
  const roots = [...new Set(subjectIds)];
  if (roots.length === 0) return result;

  // The ImageObject each subject points at via any open entity-run:
  // emblem first, then depiction, then lowest id.
  const imageEntityOf = new Map<number, { id: number; rank: number }>();
  for (const chunk of chunked(roots)) {
    for (const r of db.all<{ subjectId: number; imageId: number; predicate: string }>(sql`
      SELECT p.cached_entity_id AS subjectId, p.cached_object_entity_id AS imageId, p.predicate AS predicate
      FROM properties p
      JOIN entity_types t
        ON t.entity_id = p.cached_object_entity_id AND t.type = 'ImageObject'
      WHERE p.cached_period_to IS NULL
        AND p.agent_sourced_id IS NULL
        AND p.cached_object_entity_id IS NOT NULL
        AND p.cached_entity_id IN (${sql.join(
          chunk.map(id => sql`${id}`),
          sql`, `
        )})
    `)) {
      const cand = { id: r.imageId, rank: rankOf(r.predicate) };
      const cur = imageEntityOf.get(r.subjectId);
      if (
        cur === undefined ||
        cand.rank > cur.rank ||
        (cand.rank === cur.rank && cand.id < cur.id)
      ) {
        imageEntityOf.set(r.subjectId, cand);
      }
    }
  }
  if (imageEntityOf.size === 0) return result;

  const urls = entityUrls(db, [...new Set([...imageEntityOf.values()].map(c => c.id))]);
  for (const [subjectId, cand] of imageEntityOf) {
    const url = urls.get(cand.id);
    if (url !== undefined) result.set(subjectId, url);
  }
  return result;
}

/**
 * A representative image attachment for each given subject entity, when one is
 * reachable: the entity itself, or any entity one hop away (via an entity-valued
 * property, e.g. a posting's `image` or a message's `contains`) that carries an
 * `attachmentCid` whose stored blob is an image. The pick is deterministic — the
 * subject itself first, then its lowest-id neighbor — so a row's thumbnail is
 * stable across renders. Mime is taken from the authoritative `attachments`
 * table, not the (optional) entity `mimeType` property.
 */
export function resolveImageAttachments(db: Db, subjectIds: number[]): Map<number, ActionImageRef> {
  const result = new Map<number, ActionImageRef>();
  const roots = [...new Set(subjectIds)];
  if (roots.length === 0) return result;

  // One-hop neighbors via entity-valued, non-special, open-run properties.
  const neighbors = new Map<number, number[]>();
  for (const chunk of chunked(roots)) {
    for (const r of db.all<{ rootId: number; childId: number }>(sql`
      SELECT p.cached_entity_id AS rootId, p.cached_object_entity_id AS childId
      FROM properties p
      WHERE p.cached_period_to IS NULL
        AND p.agent_sourced_id IS NULL
        AND p.cached_object_entity_id IS NOT NULL
        AND p.cached_entity_id IN (${sql.join(
          chunk.map(id => sql`${id}`),
          sql`, `
        )})
    `)) {
      const list = neighbors.get(r.rootId) ?? [];
      list.push(r.childId);
      neighbors.set(r.rootId, list);
    }
  }

  // Candidate media entities per root, in deterministic pick order.
  const candidatesByRoot = new Map<number, number[]>();
  const allMedia = new Set<number>();
  for (const root of roots) {
    const ordered = [root, ...[...(neighbors.get(root) ?? [])].sort((a, b) => a - b)];
    candidatesByRoot.set(root, ordered);
    for (const id of ordered) allMedia.add(id);
  }

  // The attachmentCid each candidate carries (open run), if any.
  const cidByEntity = new Map<number, string>();
  for (const chunk of chunked([...allMedia])) {
    for (const r of db.all<{ entityId: number; body: string }>(sql`
      SELECT p.cached_entity_id AS entityId, v.body AS body
      FROM properties p
      JOIN vals v ON v.id = p.value_id
      WHERE p.predicate = 'attachmentCid'
        AND p.cached_period_to IS NULL
        AND p.agent_sourced_id IS NULL
        AND p.cached_entity_id IN (${sql.join(
          chunk.map(id => sql`${id}`),
          sql`, `
        )})
    `)) {
      if (!cidByEntity.has(r.entityId)) cidByEntity.set(r.entityId, JSON.parse(r.body) as string);
    }
  }
  if (cidByEntity.size === 0) return result;

  // Keep only cids whose stored blob is an image (authoritative mime).
  const imageMime = new Map<string, string>();
  for (const chunk of chunked([...new Set(cidByEntity.values())])) {
    for (const r of db.all<{ cid: string; mimeType: string | null }>(sql`
      SELECT cid, mime_type AS mimeType FROM attachments
      WHERE cid IN (${sql.join(
        chunk.map(c => sql`${c}`),
        sql`, `
      )})
    `)) {
      if (r.mimeType !== null && r.mimeType.startsWith('image/')) imageMime.set(r.cid, r.mimeType);
    }
  }

  // First candidate per root that resolves to an image.
  for (const root of roots) {
    for (const mediaId of candidatesByRoot.get(root) ?? []) {
      const cid = cidByEntity.get(mediaId);
      if (cid === undefined) continue;
      const mimeType = imageMime.get(cid);
      if (mimeType === undefined) continue;
      result.set(root, { cid, mimeType });
      break;
    }
  }
  return result;
}

/**
 * A representative image for each subject reached in REVERSE via `snapshotOf`: a
 * MediaObject that is a snapshot OF the subject (a page's viewport screenshot, a
 * manual capture). Picks the LATEST image snapshot (highest entity id — most
 * recently minted) and only image blobs, so an MHTML archive — which also
 * `snapshotOf` the page — drops out. Last-resort, so a curated emblem/depiction
 * always wins over a screenshot.
 */
export function resolveSnapshotImages(db: Db, subjectIds: number[]): Map<number, ActionImageRef> {
  const result = new Map<number, ActionImageRef>();
  const roots = [...new Set(subjectIds)];
  if (roots.length === 0) return result;

  // Media that is a `snapshotOf` each root (the reverse edge).
  const mediaByRoot = new Map<number, number[]>();
  const allMedia = new Set<number>();
  for (const chunk of chunked(roots)) {
    for (const r of db.all<{ rootId: number; mediaId: number }>(sql`
      SELECT p.cached_object_entity_id AS rootId, p.cached_entity_id AS mediaId
      FROM properties p
      WHERE p.predicate = 'snapshotOf'
        AND p.cached_period_to IS NULL
        AND p.agent_sourced_id IS NULL
        AND p.cached_object_entity_id IN (${sql.join(
          chunk.map(id => sql`${id}`),
          sql`, `
        )})
    `)) {
      const list = mediaByRoot.get(r.rootId) ?? [];
      list.push(r.mediaId);
      mediaByRoot.set(r.rootId, list);
      allMedia.add(r.mediaId);
    }
  }
  if (allMedia.size === 0) return result;

  // Each snapshot's own image blob. An ImageObject carries an image
  // attachmentCid; an MHTML DocumentObject's blob is not an image, so it has no
  // ref here and is skipped when picking the latest.
  const refs = resolveImageAttachments(db, [...allMedia]);
  for (const [root, media] of mediaByRoot) {
    let best: number | undefined;
    for (const mediaId of media) {
      if (refs.has(mediaId) && (best === undefined || mediaId > best)) best = mediaId;
    }
    if (best === undefined) continue;
    const ref = refs.get(best);
    if (ref !== undefined) result.set(root, ref);
  }
  return result;
}
/**
 * The best available image for each of `ids`, applying the preference order
 * above. One call so a caller does not have to know the three sources exist.
 */
export function resolveImageRefs(db: Db, ids: number[]): Map<number, ActionImageRef> {
  const blobs = resolveImageAttachments(db, ids);
  const urls = resolveImageUrls(db, ids);
  const snapshots = resolveSnapshotImages(db, ids);
  const out = new Map<number, ActionImageRef>();
  for (const id of new Set(ids)) {
    const blob = blobs.get(id);
    if (blob !== undefined) {
      out.set(id, blob);
      continue;
    }
    const url = urls.get(id);
    if (url !== undefined) {
      out.set(id, { url });
      continue;
    }
    const snapshot = snapshots.get(id);
    if (snapshot !== undefined) out.set(id, snapshot);
  }
  return out;
}
