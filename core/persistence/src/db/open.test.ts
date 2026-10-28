import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from './nodeSqlite.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './open.js';
import { processEvent } from '../process.js';

const CLAIM = {
  '@type': 'ExecuteAction',
  '@key': ['@type', 'source', 'timestamp'],
  '@assertedAt': '2026-07-17T10:00:00.000Z',
  source: 'shell-live',
  timestamp: '2026-07-17T10:00:00.000Z',
  agent: {
    '@type': 'Person',
    '@key': ['@type', 'source', 'handle'],
    source: 'shell-live',
    handle: 'andrew',
    sameAs: ['@me'],
  },
  object: {
    '@type': 'Command',
    '@key': ['@type', 'source', 'body', 'action.timestamp'],
    source: 'shell-live',
    body: 'ls -la',
  },
};

const schemaVersion = (sqlite: { pragma(p: string, o?: { simple: boolean }): unknown }): number =>
  sqlite.pragma('schema_version', { simple: true }) as number;

describe('openDatabase({ readonly })', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chr-open-'));
    path = join(dir, 'store.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a store a writer created and refuses every write', async () => {
    const writer = openDatabase({ path });
    await processEvent(writer.db, CLAIM, { blobs: writer.blobs });
    const version = schemaVersion(writer.sqlite);
    writer.close();

    const reader = openDatabase({ path, readonly: true });
    try {
      const { n } = reader.sqlite.prepare('SELECT count(*) AS n FROM actions').get() as {
        n: number;
      };
      expect(n).toBe(1);
      // No DDL ran: neither the schema nor the debug views were touched.
      expect(schemaVersion(reader.sqlite)).toBe(version);
      expect(() => reader.sqlite.exec("INSERT INTO meta (key, value) VALUES ('k', 'v')")).toThrow(
        /readonly/i
      );
    } finally {
      reader.close();
    }
  });

  it('never creates a store: a missing path is a clear error', () => {
    expect(() => openDatabase({ path: join(dir, 'nope.db'), readonly: true })).toThrow(
      /No archive yet/
    );
  });

  it('still refuses a store from an older schema revision', () => {
    const legacy = new Database(path);
    legacy.exec('CREATE TABLE property_observations (id INTEGER PRIMARY KEY)');
    legacy.close();
    expect(() => openDatabase({ path, readonly: true })).toThrow(/older schema/);
  });
});

describe('openDatabase — inbox schema revision', () => {
  it('refuses a store whose inbox predates lanes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chr-open-inbox-'));
    const path = join(dir, 'store.db');
    try {
      const old = new Database(path);
      old.exec(
        'CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, revoked_at INTEGER, last_delivered_at INTEGER);' +
          "CREATE TABLE inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id TEXT NOT NULL, client_id TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, reason TEXT, cid TEXT, drained_at INTEGER);"
      );
      old.close();
      expect(() => openDatabase({ path })).toThrow(/older schema/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
