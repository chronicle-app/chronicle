import { openDatabase } from '../db/open.js';
import type { OpenResult } from '../db/open.js';

/**
 * Fresh in-memory database with the schema applied. Cheap; no external DB.
 * Each call is fully isolated — use one per permutation order.
 */
export function makeTestDb(): OpenResult {
  return openDatabase({ path: ':memory:', migrate: true });
}
