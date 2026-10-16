import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { inflateRawSync } from 'node:zlib';
import { parseBinaryPlist, Uid, type PlistValue } from '@chronicle.app/apple';
import { APPLE_EPOCH_OFFSET_SECONDS, allRows, getRow } from '@chronicle.app/etl-sqlite';

/**
 * A Core Data SQLite store, as Photos writes one. Entity numbers, table
 * columns, and join table names change between macOS versions, so they're
 * read from the store rather than written into queries: `Z_PRIMARYKEY` numbers
 * the entities, `PRAGMA table_info` lists a table's columns, and the model the
 * store keeps of itself (`Z_MODELCACHE`) says how its change log numbers each
 * entity's properties.
 */
export class CoreDataStore {
  readonly db: DatabaseSync;
  private readonly entities: Map<string, number>;
  private readonly tables = new Map<string, Set<string>>();
  private model: Map<string, ModelEntity> | null | undefined;

  constructor(db: DatabaseSync) {
    this.db = db;
    const rows = allRows<{ name: string; ent: number }>(
      db.prepare('SELECT Z_NAME AS name, Z_ENT AS ent FROM Z_PRIMARYKEY')
    );
    this.entities = new Map(rows.map(row => [row.name, row.ent]));
  }

  /** The number the store gives an entity, such as 3 for `Asset`. */
  entity(name: string): number | null {
    return this.entities.get(name) ?? null;
  }

  /** A table's columns, or none when the store has no such table. */
  columns(table: string): Set<string> {
    let columns = this.tables.get(table);
    if (!columns) {
      const rows = allRows<{ name: string }>(
        this.db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
      );
      columns = new Set(rows.map(row => row.name));
      this.tables.set(table, columns);
    }
    return columns;
  }

  /** `alias.column` when the table has the column, and `NULL` when it doesn't. */
  column(alias: string, table: string, column: string): string {
    return this.columns(table).has(column) ? `${alias}.${column}` : 'NULL';
  }

  /**
   * The join table of a many-to-many relationship, given each side as its
   * entity and its relationship to the other. Core Data names it after one
   * side, such as `Z_34ASSETS` for an album's `assets`, with a column for each
   * side's row, such as `Z_34ALBUMS` for the album and `Z_3ASSETS` for the
   * asset.
   */
  joinTable(
    [entityA, toB]: [string, string],
    [entityB, toA]: [string, string]
  ): { table: string; a: string; b: string } | null {
    const a = this.entity(entityA);
    const b = this.entity(entityB);
    if (a === null || b === null) return null;
    const columnA = `Z_${a}${toA.toUpperCase()}`;
    const columnB = `Z_${b}${toB.toUpperCase()}`;
    for (const table of [`Z_${a}${toB.toUpperCase()}`, `Z_${b}${toA.toUpperCase()}`]) {
      const columns = this.columns(table);
      if (columns.has(columnA) && columns.has(columnB)) return { table, a: columnA, b: columnB };
    }
    return null;
  }

  /**
   * Where a change to each of an entity's properties shows in its change
   * log's `ZCOLUMNS`, by property name, or null when the store's model can't
   * be read.
   */
  changeSlots(entity: string): Map<string, number> | null {
    if (this.model === undefined) this.model = readModel(this.db);
    if (!this.model?.has(entity)) return null;
    return slotsOf(this.model, entity);
  }
}

/** Whether a change's `ZCOLUMNS` marks the property in `slot` as changed. */
export function changed(columns: Uint8Array | null, slot: number | undefined): boolean {
  if (!columns || slot === undefined) return false;
  // Each byte holds eight slots, the first in its highest bit.
  const byte = Math.floor(slot / 8);
  if (byte >= columns.length) return false;
  return Math.floor(columns[byte] / 2 ** (7 - (slot % 8))) % 2 === 1;
}

/** A Core Data date, in seconds since 2001, as an ISO instant. */
export function appleDate(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}

/**
 * When a store last changed: the database or its write-ahead log, which
 * holds changes Core Data hasn't yet written back.
 */
export function lastChanged(database: string): Date | null {
  const times = [database, `${database}-wal`].flatMap(file => {
    try {
      return [statSync(file).mtime.getTime()];
    } catch {
      return [];
    }
  });
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

interface ModelProperty {
  name: string;
  kind: 'attribute' | 'toOne' | 'toMany';
  transient: boolean;
  /** The entity a relationship points to. */
  destination: string | null;
  /** The relationship back, when there is one. */
  inverse: { toMany: boolean; ordered: boolean } | null;
}

interface ModelEntity {
  name: string;
  parent: string | null;
  hasSubentities: boolean;
  properties: ModelProperty[];
}

// A relationship description's flags (`_P`) mark an ordered one with this bit.
const ORDERED = 1024;

/**
 * The model a store keeps of itself: `Z_MODELCACHE` holds the store's
 * managed object model, archived with NSKeyedArchiver and compressed with
 * raw deflate.
 */
function readModel(db: DatabaseSync): Map<string, ModelEntity> | null {
  try {
    const row = getRow<{ content: Uint8Array | null }>(
      db.prepare('SELECT Z_CONTENT AS content FROM Z_MODELCACHE')
    );
    if (!row?.content) return null;
    const archive = parseBinaryPlist(inflateRawSync(row.content)) as { [key: string]: PlistValue };
    const objects = archive.$objects;
    if (!Array.isArray(objects)) return null;

    const at = (value: PlistValue | undefined): PlistValue | undefined => {
      const resolved = value instanceof Uid ? objects[value.index] : value;
      // Entry 0 is `$null`, the archive's nil.
      return resolved === '$null' ? null : resolved;
    };
    const fields = (value: PlistValue | undefined) =>
      (at(value) ?? {}) as { [key: string]: PlistValue };
    const className = (value: PlistValue | undefined): string | null => {
      const object = at(value);
      if (!object || typeof object !== 'object' || !('$class' in object)) return null;
      const name = fields((object as { $class: PlistValue }).$class).$classname;
      return typeof name === 'string' ? name : null;
    };
    const entries = (value: PlistValue | undefined): Array<[PlistValue, PlistValue]> => {
      const dictionary = fields(value);
      const keys = dictionary['NS.keys'];
      const values = dictionary['NS.objects'];
      if (!Array.isArray(keys) || !Array.isArray(values)) return [];
      return keys.map((key, i) => [at(key) ?? null, values[i]]);
    };

    const property = (name: string, value: PlistValue): ModelProperty | null => {
      const kind = className(value);
      const description = fields(value);
      if (kind === 'NSAttributeDescription' || kind === 'NSDerivedAttributeDescription') {
        const transient = at(description.NSIsTransient) === true;
        return { name, kind: 'attribute', transient, destination: null, inverse: null };
      }
      if (kind !== 'NSRelationshipDescription') return null;
      const inverse = at(description.NSInverseRelationship);
      const destination = at(description._NSDestinationEntityName);
      const inverseFields = fields(inverse ?? undefined);
      return {
        name,
        kind: at(description.NSMaxCount) === 1 ? 'toOne' : 'toMany',
        transient: false,
        destination: typeof destination === 'string' ? destination : null,
        inverse:
          inverse && typeof inverse === 'object'
            ? {
                toMany: at(inverseFields.NSMaxCount) !== 1,
                ordered: Math.floor(Number(at(inverseFields._P)) / ORDERED) % 2 === 1,
              }
            : null,
      };
    };

    const model = new Map<string, ModelEntity>();
    for (const object of objects) {
      if (className(object) !== 'NSEntityDescription') continue;
      const entity = fields(object);
      const name = at(entity.NSEntityName);
      if (typeof name !== 'string') continue;
      const parentName = at(fields(entity.NSSuperentity).NSEntityName);
      model.set(name, {
        name,
        parent: typeof parentName === 'string' ? parentName : null,
        hasSubentities: entries(entity.NSSubentities).length > 0,
        properties: entries(entity.NSProperties).flatMap(([key, value]) => {
          const found = typeof key === 'string' ? property(key, value) : null;
          return found ? [found] : [];
        }),
      });
    }
    return model;
  } catch {
    return null;
  }
}

const byName = (a: ModelProperty, b: ModelProperty) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * The slot each of an entity's properties takes in its change log's
 * `ZCOLUMNS`. Core Data lays an entity out in this order, its ancestors'
 * properties before its own within each part:
 *
 * 1. to-one relationships, by name
 * 2. a slot for each to-one relationship to an entity with subentities, and
 *    one for each whose inverse is an ordered to-many relationship
 * 3. attributes that aren't transient, by name
 * 4. to-many relationships whose inverse is to-one, then many-to-many ones,
 *    in the model's order
 *
 * Parts 1 to 3 hold for every entity in Photos' model. Part 4's order holds
 * for `Asset` and for `Album.assets`, but not for every entity.
 */
function slotsOf(model: Map<string, ModelEntity>, name: string): Map<string, number> {
  const chain: ModelEntity[] = [];
  for (let entity = model.get(name); entity; entity = model.get(entity.parent ?? '')) {
    chain.unshift(entity);
  }
  const seen = new Set<string>();
  const levels = chain.map(entity => {
    const own = entity.properties.filter(p => !seen.has(p.name));
    for (const p of own) seen.add(p.name);
    return own;
  });
  const toOne = levels.flatMap(level => level.filter(p => p.kind === 'toOne').sort(byName));
  const attributes = levels.flatMap(level =>
    level.filter(p => p.kind === 'attribute' && !p.transient).sort(byName)
  );
  const toMany = levels.flatMap(level => level.filter(p => p.kind === 'toMany'));
  const order: Array<string | null> = [
    ...toOne.map(p => p.name),
    ...toOne.filter(p => model.get(p.destination ?? '')?.hasSubentities).map(() => null),
    ...toOne.filter(p => p.inverse?.toMany && p.inverse.ordered).map(() => null),
    ...attributes.map(p => p.name),
    ...toMany.filter(p => !p.inverse?.toMany).map(p => p.name),
    ...toMany.filter(p => p.inverse?.toMany).map(p => p.name),
  ];
  return new Map(order.flatMap((property, slot) => (property ? [[property, slot]] : [])));
}
