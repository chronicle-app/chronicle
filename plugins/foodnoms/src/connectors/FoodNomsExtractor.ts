import { Record } from '@chronicle.app/etl';
import { SqliteExtractor, timeRangeConditions } from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import FoodNomsTransformer from './FoodNomsTransformer.js';

/**
 * FoodNoms' built-in meal slots. Their names aren't stored in the database (only
 * user-customized slots get a mealTypeRecord row), so these defaults map the
 * stock mealTypeID values. Confirmed against this store two ways: id 3 is the
 * one row that exists and carries an 18:00–22:15 time range (Dinner), and the
 * per-id entry times line up (id 1 ≈ 09:00, 2 ≈ 12:00, 3 ≈ 19:00, 4 spread).
 * Custom ids (e.g. 6, 7) have no name anywhere and stay unmapped.
 */
const BUILTIN_MEAL_TYPES: { [id: string]: string } = {
  '1': 'Breakfast',
  '2': 'Lunch',
  '3': 'Dinner',
  '4': 'Snacks',
};

export class FoodNomsExtractor extends SqliteExtractor<typeof FoodNomsExtractor> {
  static override source = 'foodnoms';
  static override strategy = 'app-db';
  static override description = 'Logged meals';
  static override recordTypes: string[] = ['meals'];
  static override default = true;
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .describe('Path to the FoodNoms SQLite database file')
      .default(
        `${process.env.HOME}/Library/Containers/com.algebraiclabs.foodnoms/Data/Documents/db.db`
      ),
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
  }) as any; // Type assertion to override constraint

  static override defaultTransformer = FoodNomsTransformer;

  /**
   * `entryID` is a 16-byte CloudKit record UUID stored as a BLOB, so it comes
   * out of SQLite as `hex(entryID)` (32 hex chars) and is reshaped into the
   * canonical dashed UUID. (`foodID`/`versionID`/`mealTypeID` are plain TEXT and
   * must NOT go through here — they are already string identifiers.)
   */
  private hexToUuid(hex: string | null): string | null {
    if (!hex) return null;
    const cleaned = hex.toLowerCase();
    return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20, 32)}`;
  }

  /**
   * FoodNoms stores DATETIME columns as naive `YYYY-MM-DD HH:MM:SS.sss` strings
   * in UTC (CloudKit sync semantics; `tzID` only records the display zone). The
   * `since`/`until` config values are real Dates, so format them to that same
   * shape — a raw `toISOString()` would carry a `T`/`Z` and never compare
   * correctly against the column's space-separated text.
   */
  private toDbDate(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '');
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const conditions = [`1=1`];
    const values: any[] = [];

    const range = timeRangeConditions('f.date', this.config, {
      convert: date => this.toDbDate(date),
      sinceOp: '>=',
      untilOp: '<=',
    });
    conditions.push(...range.conditions);
    values.push(...range.values);

    const limit = this.getEffectiveLimit();
    if (limit !== null) {
      values.push(limit);
    }

    const query = `
      SELECT
        f.id,
        hex(f.entryID) as entryID,
        f.date,
        f.dateCreated,
        f.dateLastUpdated,
        f.tzID,
        f.quantity,
        f.calories,
        f.foodID,
        f.versionID,
        f.barcode,
        f.source,
        f.secondarySource,
        f.name,
        f.brandOwner,
        f.baseUnit,
        f.baseAmount,
        f.nutrients,
        f.mealTypeID,
        f.day,
        m.name as mealTypeName,
        m.timeRangeStart as mealTimeRangeStart,
        m.timeRangeEnd as mealTimeRangeEnd,
        -- FoodNoms can store sortIndex near Int64.min (e.g. -9223372036854775805),
        -- which node:sqlite refuses to read as a number, so out-of-range values
        -- come through as text.
        CASE
          WHEN m.sortIndex BETWEEN -9007199254740991 AND 9007199254740991 THEN m.sortIndex
          ELSE CAST(m.sortIndex AS TEXT)
        END as mealSortIndex
      FROM foodEntryRecord f
      LEFT JOIN mealTypeRecord m ON f.mealTypeID = m.mealTypeID
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.date DESC
      ${limit === null ? '' : 'LIMIT ?'}
    `;

    const rows = this.db.prepare(query).all(...values);

    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    for (const row of rows) {
      // Parse nutrients JSON if present
      let nutrients = null;
      if ((row as any).nutrients) {
        try {
          nutrients = JSON.parse((row as any).nutrients);
        } catch (error) {
          this.logger.warn(`Failed to parse nutrients JSON: ${error}`);
        }
      }

      // entryID is the only blob UUID; foodID/versionID/mealTypeID are plain
      // text and pass through untouched. The naive UTC date strings get a 'Z'
      // so `new Date(...)` reads them as the UTC instants they are.
      const processedRow = {
        ...(row as any),
        entryID: this.hexToUuid((row as any).entryID),
        nutrients,
        date: (row as any).date ? (row as any).date + 'Z' : null,
        dateCreated: (row as any).dateCreated ? (row as any).dateCreated + 'Z' : null,
        dateLastUpdated: (row as any).dateLastUpdated ? (row as any).dateLastUpdated + 'Z' : null,
      };

      // Resolve the meal slot's name. mealTypeRecord only holds rows the user
      // has customized (the built-ins live in the app), so the join is usually
      // empty and we fall back to FoodNoms' built-in id→name defaults. A real
      // (renamed/custom) name from the join always wins; unknown custom ids
      // resolve to null rather than a synthesized label.
      const mealTypeId = (row as any).mealTypeID;
      const joinName = ((row as any).mealTypeName as string | null)?.trim() || null;
      const mealTypeName = joinName ?? BUILTIN_MEAL_TYPES[mealTypeId] ?? null;
      const mealType = mealTypeId
        ? {
            id: mealTypeId,
            name: mealTypeName,
            timeRangeStart: (row as any).mealTimeRangeStart,
            timeRangeEnd: (row as any).mealTimeRangeEnd,
            sortIndex: (row as any).mealSortIndex,
          }
        : null;

      yield this.createRecord(processedRow, {
        mealType,
        account,
      });
    }
  }
}
