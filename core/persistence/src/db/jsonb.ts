import { customType } from 'drizzle-orm/sqlite-core';

/**
 * A JSON-valued column stored as TEXT.
 *
 * The design doc specifies JSONB BLOBs; for this slice we store canonical JSON
 * TEXT instead — it is debuggable and fully deterministic, and the doc itself
 * notes BLOB packing is a later optimization. Determinism does NOT come from the
 * column type: callers are expected to pass values that have already been run
 * through `canonicalize()` (deep, stable key order), so `JSON.stringify` here
 * preserves that canonical order on the way to the driver.
 */
export const jsonb = <T = unknown>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType() {
      return 'text';
    },
    toDriver(value: T): string {
      return JSON.stringify(value);
    },
    fromDriver(value: string): T {
      return JSON.parse(value) as T;
    },
  })(name);
