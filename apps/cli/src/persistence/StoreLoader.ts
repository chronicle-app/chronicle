import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Loader, type LoadResult, type Record } from '@chronicle.app/etl';
import { FoldBatcher, ingestEvent, ValidationError } from '@chronicle.app/persistence';
import { openStore, type OpenStore } from './store.js';

/**
 * The local store as an ETL loader — the terminal sink that lands Chronicle
 * JSON-LD records in the store. A source run with this loader is
 * `chronicle import <source>`.
 *
 * Each record is ingested as it arrives, so a record the store rejects fails
 * on its own with the reason, and the ingested ones fold in batches of
 * `fold-batch` (one transaction each). Teardown folds the last batch.
 * Idempotent: re-loading the same record is a duplicate (content-addressed).
 */
export class StoreLoader extends Loader<typeof StoreLoader> {
  static override source = 'store';
  static override printsRecords = false;
  static override schema = z.object({
    db: z.string().optional().describe('Store path'),
    'fold-batch': z.number().int().positive().optional().describe('Records per fold'),
  });

  private store?: OpenStore;
  private batcher?: FoldBatcher;

  /** Landed counts, readable after the run for a summary line. */
  public created = 0;
  public duplicate = 0;
  public failed = 0;

  public override async setup(): Promise<void> {
    this.store = openStore(this.config.db);
    this.batcher = new FoldBatcher(this.store.db, { batchSize: this.config['fold-batch'] });
  }

  async load(record: Record): Promise<LoadResult> {
    if (!this.store || !this.batcher) throw new Error('StoreLoader.setup() was not called');
    try {
      const result = await ingestEvent(this.store.db, record.data, {
        blobs: this.store.blobs,
        readFile: path => readFile(path),
      });
      if (result.isNew) this.created += 1;
      else this.duplicate += 1;
      this.batcher.add(result.cid);
      return { success: true, record };
    } catch (error) {
      // A record the store can't take fails alone; anything else (a locked
      // store, a full disk) stops the run.
      if (!(error instanceof ValidationError)) throw error;
      this.failed += 1;
      return { success: false, record, error: error.message };
    }
  }

  public get dbPath(): string | undefined {
    return this.store?.path;
  }

  public override async teardown(): Promise<void> {
    try {
      this.batcher?.flush();
    } finally {
      this.store?.close();
      this.store = undefined;
      this.batcher = undefined;
    }
  }
}
