import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import {
  SqliteExtractor,
  countsByMonth,
  monthSql,
  timeRangeConditions,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/apple';
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

// When an entry was eaten: its time, or for one logged to a day without a
// time, the middle of that day in UTC, so it falls on that day in any zone
// within twelve hours. `day` is the day it was logged to, a Julian day number
// in FoodNoms, which strftime reads as it does a date.
const EATEN_AT = `COALESCE(f.date, strftime('%Y-%m-%d 12:00:00.000', f.day))`;

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

  /**
   * Entries eaten within since and until, both inclusive. A food in a saved
   * collection (a recipe, a saved meal) is an entry too, but one never eaten,
   * with no time or day, so it's left out.
   */
  private entryFilter(): { where: string; values: Array<number | string> } {
    const range = timeRangeConditions(EATEN_AT, this.config, {
      convert: date => this.toDbDate(date),
      sinceOp: '>=',
      untilOp: '<=',
    });
    const collected = this.hasColumn('collectionEditID') ? ['f.collectionEditID IS NULL'] : [];
    return {
      where: [`1=1`, ...collected, ...range.conditions].join(' AND '),
      values: range.values,
    };
  }

  /** Whether the entry table has a column, which an older FoodNoms may not. */
  private hasColumn(name: string): boolean {
    return Boolean(
      this.db!.prepare(`SELECT 1 FROM pragma_table_info('foodEntryRecord') WHERE name = ?`).get(
        name
      )
    );
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const { where, values } = this.entryFilter();

    const limit = this.getEffectiveLimit();
    if (limit !== null) {
      values.push(limit);
    }

    const query = `
      SELECT
        f.id,
        hex(f.entryID) as entryID,
        f.date,
        ${EATEN_AT} as eatenAt,
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
      WHERE ${where}
      ORDER BY ${EATEN_AT} DESC
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
        eatenAt: (row as any).eatenAt ? (row as any).eatenAt + 'Z' : null,
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

  /** The items a run reads, each one food or drink logged, and when they were eaten. */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.db) return null;
    const { where, values } = this.entryFilter();
    const from = `FROM foodEntryRecord f
      LEFT JOIN mealTypeRecord m ON f.mealTypeID = m.mealTypeID
      WHERE ${where}`;
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n, MIN(${EATEN_AT}) AS first, MAX(${EATEN_AT}) AS last ${from}`)
      .get(...values) as { n: number; first: string | null; last: string | null };
    // strftime reads the naive date strings as UTC too.
    const month = monthSql(`CAST(strftime('%s', ${EATEN_AT}) AS INTEGER)`);
    const byMonth =
      options.byMonth &&
      countsByMonth(
        this.db
          .prepare(`SELECT ${month} AS month, COUNT(*) AS n ${from} GROUP BY month`)
          .all(...values) as Array<{ month: string | null; n: number }>
      );
    // Naive UTC date strings, read as the UTC instants they are, as extract() does.
    return {
      meals: {
        count: row.n,
        label: 'items',
        ...(row.first !== null && { earliest: new Date(row.first + 'Z') }),
        ...(row.last !== null && { latest: new Date(row.last + 'Z') }),
        ...(byMonth && { byMonth }),
      },
    };
  }
}
