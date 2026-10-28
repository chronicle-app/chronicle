import type { Db, SqliteDriver } from '../db/driver.js';
import { UnsupportedConstraintError } from './evaluate.js';

export type { ActionQueryOptions, ActionQueryPage, QueryOptions, QueryPage } from './evaluate.js';
export { UnsupportedConstraintError } from './evaluate.js';
export type { ConstraintNode, TemporalModifier } from '@chronicle.app/cql';

type Open = { db: Db; sqlite: SqliteDriver };

/**
 * A page of matching ids with keyset paging metadata — the pre-serialization
 * form of the by-id/role/backlink queries. The shape-driven serve boundary
 * (`GET /entities/:key/actions`, `/backlinks`, `POST /collections/members`)
 * projects `ids` through a shape into a bag.
 */
export interface IdPage {
  ids: number[];
  hasMore: boolean;
  nextCursor?: string;
}

/** Action role columns an entity can fill, plus `any` (matches every role). */
const ROLE_COLUMN: Record<string, string> = {
  agent: 'cached_agent_entity_id',
  object: 'cached_object_entity_id',
  result: 'cached_result_entity_id',
  instrument: 'cached_instrument_entity_id',
  target: 'cached_target_entity_id',
};

export type EntityActionRole = keyof typeof ROLE_COLUMN | 'any' | 'interactions';

export interface EntityActionsOptions {
  /** Restrict to actions where the entity fills this role (default: any role). */
  role?: EntityActionRole;
  limit?: number;
  /** Keyset cursor `<occurredAt>|<actionId>` (same shape as the timeline). */
  cursor?: string;
}

/**
 * Actions that reference a given entity in a role slot (its agent, object, …),
 * newest-first and keyset-paginated like the timeline. This is the role-by-id
 * query the CQL action engine can't express — e.g. "actions where this person is
 * the agent" for an agent page.
 *
 * The `interactions` role is the full bidirectional feed: the entity's
 * own actions (it is the agent) plus the actions that targeted it via the
 * encounter log (it is the subject — a message sent *to* it, something done
 * *with* it). An encounter's encounterer is always the action's agent, so that
 * side adds nothing over the agent role; the subject side is the new direction.
 */
export function queryEntityActionIds(
  open: Open,
  entityId: number,
  options: EntityActionsOptions = {}
): IdPage {
  const limit = options.limit ?? 50;
  const role = options.role ?? 'any';
  const params: number[] = [];
  let where: string;
  if (role === 'interactions') {
    where =
      '(a.cached_agent_entity_id = ?' +
      ' OR a.id IN (SELECT originating_action_id FROM encounters WHERE cached_subject_entity_id = ?))';
    params.push(entityId, entityId);
  } else {
    const columns = role === 'any' ? Object.values(ROLE_COLUMN) : [ROLE_COLUMN[role]];
    where = `(${columns.map(c => `a.${c} = ?`).join(' OR ')})`;
    for (const _ of columns) params.push(entityId);
  }
  if (options.cursor !== undefined) {
    const match = /^(-?\d+)\|(\d+)$/.exec(options.cursor);
    if (!match) throw new UnsupportedConstraintError(`Invalid cursor: "${options.cursor}"`);
    where += ' AND (a.occurred_at < ? OR (a.occurred_at = ? AND a.id < ?))';
    params.push(Number(match[1]), Number(match[1]), Number(match[2]));
  }
  const rows = open.sqlite
    .prepare(
      `SELECT a.id AS id, a.occurred_at AS occurredAt FROM actions a WHERE ${where}` +
        ` ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${Number(limit) + 1}`
    )
    .all(...params) as Array<{ id: number; occurredAt: number }>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    ids: page.map(r => r.id),
    hasMore,
    ...(hasMore && last ? { nextCursor: `${last.occurredAt}|${last.id}` } : {}),
  };
}

export interface ActionsByIdsOptions {
  limit?: number;
  /** Keyset cursor `<occurredAt>|<actionId>` (same shape as the timeline). */
  cursor?: string;
}

/**
 * Page a pre-resolved set of action ids into the timeline, newest-first and
 * keyset-paginated exactly like the CQL/role queries — the id-set analogue.
 * Chronicle Collections resolve their membership (`rule ∪ roster − excludes`) to
 * a `Set<number>` of action ids via `resolveMemberActionIds`; this pages that set
 * for the web surface, reusing the *same* resolved set the
 * export/backup/sync consumers see so a preview can never drift from what was
 * resolved.
 *
 * The set is bound as a single JSON array through `json_each`, so an
 * unbounded membership (a loose rule can match thousands) never runs into the
 * SQL bound-parameter limit.
 */
export function queryActionIdsByIds(
  open: Open,
  ids: Iterable<number>,
  options: ActionsByIdsOptions = {}
): IdPage {
  const limit = options.limit ?? 50;
  const params: Array<number | string> = [JSON.stringify([...ids])];
  let where = 'a.id IN (SELECT value FROM json_each(?))';
  if (options.cursor !== undefined) {
    const match = /^(-?\d+)\|(\d+)$/.exec(options.cursor);
    if (!match) throw new UnsupportedConstraintError(`Invalid cursor: "${options.cursor}"`);
    where += ' AND (a.occurred_at < ? OR (a.occurred_at = ? AND a.id < ?))';
    params.push(Number(match[1]), Number(match[1]), Number(match[2]));
  }
  const rows = open.sqlite
    .prepare(
      `SELECT a.id AS id, a.occurred_at AS occurredAt FROM actions a WHERE ${where}` +
        ` ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${Number(limit) + 1}`
    )
    .all(...params) as Array<{ id: number; occurredAt: number }>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    ids: page.map(r => r.id),
    hasMore,
    ...(hasMore && last ? { nextCursor: `${last.occurredAt}|${last.id}` } : {}),
  };
}

export interface EntityBacklinksOptions {
  /** Restrict to referrers via this predicate (e.g. `author`). */
  predicate?: string;
  limit?: number;
  /** Keyset cursor: the last entity id from the previous page. */
  cursor?: string;
}

/**
 * Entities that reference a given entity through an open property — its
 * backlinks (e.g. the works whose `author` is this person), keyset-paginated by
 * entity id. The CQL engine can't express this (it has no by-id reverse
 * traversal), so it lives here; the serve boundary projects the ids through a
 * shape into a bag.
 */
export function queryEntityBacklinkIds(
  open: Open,
  entityId: number,
  options: EntityBacklinksOptions = {}
): IdPage {
  const limit = options.limit ?? 50;
  const params: Array<number | string> = [entityId];
  let where =
    'p.cached_object_entity_id = ? AND p.cached_period_to IS NULL AND p.agent_sourced_id IS NULL';
  if (options.predicate !== undefined) {
    where += ' AND p.predicate = ?';
    params.push(options.predicate);
  }
  if (options.cursor !== undefined) {
    const c = Number(options.cursor);
    if (!Number.isFinite(c))
      throw new UnsupportedConstraintError(`Invalid cursor: "${options.cursor}"`);
    where += ' AND p.cached_entity_id < ?';
    params.push(c);
  }
  const rows = open.sqlite
    .prepare(
      `SELECT DISTINCT p.cached_entity_id AS id FROM properties p WHERE ${where}` +
        ` ORDER BY p.cached_entity_id DESC LIMIT ${Number(limit) + 1}`
    )
    .all(...params) as Array<{ id: number }>;
  const hasMore = rows.length > limit;
  const ids = (hasMore ? rows.slice(0, limit) : rows).map(r => r.id);
  return {
    ids,
    hasMore,
    ...(hasMore && ids.length > 0 ? { nextCursor: String(ids.at(-1)) } : {}),
  };
}
