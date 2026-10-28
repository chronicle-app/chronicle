import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './open.js';
import { applyDebugViews, DEBUG_VIEWS } from './views.js';

const schemaVersion = (sqlite: { pragma(p: string, o?: { simple: boolean }): unknown }): number =>
  sqlite.pragma('schema_version', { simple: true }) as number;

describe('applyDebugViews', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chr-views-'));
    path = join(dir, 'store.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates every view on a fresh store and is a no-op on the next open', () => {
    const first = openDatabase({ path });
    const names = first.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
      .all()
      .map(r => (r as { name: string }).name);
    expect(names).toEqual(DEBUG_VIEWS.map(v => v.name).sort());
    const version = schemaVersion(first.sqlite);
    first.close();

    // A second open must not touch the schema: schema_version is SQLite's own
    // counter of schema writes, so an unchanged value proves no DROP/CREATE ran.
    const second = openDatabase({ path });
    expect(applyDebugViews(second.sqlite)).toEqual([]);
    expect(schemaVersion(second.sqlite)).toBe(version);
    second.close();
  });

  it('rewrites only a view whose stored definition drifted', () => {
    const open = openDatabase({ path });
    open.sqlite.exec('DROP VIEW debug_entities; CREATE VIEW debug_entities AS SELECT 1 AS stale');
    expect(applyDebugViews(open.sqlite)).toEqual(['debug_entities']);
    const columns = open.sqlite
      .prepare('PRAGMA table_info(debug_entities)')
      .all()
      .map(c => (c as { name: string }).name);
    expect(columns).toEqual(['id', 'name', 'types', 'sources']);
    expect(applyDebugViews(open.sqlite)).toEqual([]);
    open.close();
  });
});
