import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase } from '@chronicle.app/persistence/node';
import type { OpenResult } from '@chronicle.app/persistence';
import { chronicleDataDir } from '../config/dataDir.js';

/**
 * Resolution of *where Chronicle's local store lives*, so every command that
 * reads or writes it opens the same database files.
 */

/** Default store path. Override with `--db` or `CHRONICLE_DB`. */
export function defaultDbPath(): string {
  return join(chronicleDataDir(), 'chronicle.db');
}

export function resolveDbPath(flagPath?: string): string {
  return flagPath ?? process.env.CHRONICLE_DB ?? defaultDbPath();
}

/**
 * Attachment blobs live next to their database (`chronicle.db.attachments/`),
 * so a `--db`/`CHRONICLE_DB` override carries its blobs with it.
 */
export function attachmentsDirFor(dbPath: string): string {
  return `${dbPath}.attachments`;
}

export type OpenStore = OpenResult & { path: string; attachmentsDir: string };

export interface OpenStoreOptions {
  /**
   * Open for reading only — no directory, file, or schema is created, and the
   * handle never takes the write lock (see `OpenOptions.readonly`). Readers
   * (`query`) open this way so a fold in another process never stalls them.
   * A missing store is an error, not a fresh empty one.
   */
  readonly?: boolean;
  /** See `OpenOptions.busyTimeoutMs`. */
  busyTimeoutMs?: number;
}

/** Open (creating the directory + schema if needed) the store. */
export function openStore(flagPath?: string, options: OpenStoreOptions = {}): OpenStore {
  const path = resolveDbPath(flagPath);
  const attachmentsDir = attachmentsDirFor(path);
  if (!options.readonly) mkdirSync(dirname(path), { recursive: true });
  return { ...openDatabase({ path, attachmentsDir, ...options }), path, attachmentsDir };
}
