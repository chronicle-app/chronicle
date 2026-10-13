import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Record } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  allRows,
  getRow,
  iterateRows,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import AppleWalletTransformer from './AppleWalletTransformer.js';

const DEFAULT_DB = `${process.env.HOME}/Library/Passes/passes23.sqlite`;

/**
 * Wallet stores an amount as an integer with four decimal places: 699300 is
 * 69.93. Every amount seen so far ends in two zeros, as a two-decimal currency
 * does with four places.
 */
export const AMOUNT_SCALE = 10_000;

// since/until bounds land on transaction_date, which is seconds since the Apple epoch.
const appleBound = (date: Date) => unixToSafariTimestamp(date.getTime() / 1000);

/** A card in Wallet, from its row in `pass` and its `pass.json`. */
export interface Card {
  /** Wallet's ID for the pass, which names its folder under `Cards`. */
  uniqueId: string;
  /**
   * The card network's identifier for the card account, the same on every
   * device the card is added to.
   */
  accountIdentifier: string | null;
  /** The last digits of the card number. */
  accountSuffix: string | null;
  /** The issuer, such as `Example Bank`. */
  organizationName: string | null;
  /** The card's name as the issuer shows it, from `pass.json`. */
  description: string | null;
  /** `Credit`, `Debit`, or `Prepaid`, from `pass.json`. */
  paymentType: string | null;
}

/** One transaction as its row gives it, named after the row's columns. */
export interface Transaction {
  /** Wallet's ID for the transaction. */
  identifier: string;
  /** The issuer's own ID for it. */
  serviceIdentifier: string | null;
  /** When it happened, in UTC, to the second. */
  date: string;
  /** How much, in the currency's main unit, such as dollars. */
  amount: number | null;
  currencyCode: string | null;
  merchantName: string | null;
  merchantRawName: string | null;
  /** The merchant category code, when the issuer gives one. */
  merchantIndustryCode: number | null;
  merchantIndustryCategory: string | null;
  locality: string | null;
  administrativeArea: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Wallet's own codes, as stored. */
  transactionStatus: number | null;
  transactionType: number | null;
  adjustmentType: number | null;
  /** The card the transaction is on, when its source is known. */
  card: Card | null;
}

interface TransactionRow {
  identifier: string;
  serviceIdentifier: string | null;
  date: number;
  amount: number | null;
  currencyCode: string | null;
  merchantName: string | null;
  merchantRawName: string | null;
  merchantIndustryCode: number | null;
  merchantIndustryCategory: string | null;
  locality: string | null;
  administrativeArea: string | null;
  latitude: number | null;
  longitude: number | null;
  transactionStatus: number | null;
  transactionType: number | null;
  adjustmentType: number | null;
  sourcePid: string | null;
}

interface CardRow {
  sourcePid: string;
  uniqueId: string;
  accountIdentifier: string | null;
  accountSuffix: string | null;
  organizationName: string | null;
}

interface PassDetails {
  description: string | null;
  paymentType: string | null;
}

/**
 * The Wallet store on a Mac (`passes23.sqlite`). A card's issuer sends each
 * transaction on the card to Wallet soon after it happens, however the card
 * was used, so the store holds purchases with the time to the second. An
 * issuer sends only the last few days when a card is added; the store grows
 * from then on.
 */
export class AppleWalletExtractor extends SqliteExtractor<typeof AppleWalletExtractor> {
  static override source = 'apple-wallet';
  static override description = 'Card transactions from Apple Wallet';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['transactions'];
  static override default = true;
  static override defaultTransformer = AppleWalletTransformer;
  static override newestFirst = true;
  // A pending transaction's amount can change when it posts, so a run is a
  // read of each transaction's current state, sighted at read time.
  static override temporality = 'snapshot' as const;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe('Path to passes23.sqlite').default(DEFAULT_DB),
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
  }) as any;

  // Keyed by the transaction source's pid as text: the pids are 64-bit values
  // beyond Number's safe range.
  private cards = new Map<string, Card>();

  override async setup(): Promise<void> {
    await super.setup();
    this.cards = await this.loadCards();
  }

  /** Wallet's ID for the transaction. */
  override keyOf(record: Record): string | null {
    return (record.data as Transaction).identifier ?? null;
  }

  override occurredAt(record: Record): Date | undefined {
    return new Date((record.data as Transaction).date);
  }

  private query(select: string): { sql: string; values: Array<number | string> } {
    const range = timeRangeConditions('transaction_date', this.config, { convert: appleBound });
    const where = ['identifier IS NOT NULL', ...range.conditions].join(' AND ');
    return {
      sql: `SELECT ${select} FROM payment_transaction WHERE ${where}`,
      values: range.values,
    };
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const { sql, values } = this.query(`
      identifier, service_identifier AS serviceIdentifier, transaction_date AS date, amount,
      currency_code AS currencyCode, merchant_name AS merchantName,
      merchant_raw_name AS merchantRawName, merchant_industry_code AS merchantIndustryCode,
      merchant_industry_category AS merchantIndustryCategory, locality,
      administrative_area AS administrativeArea, location_latitude AS latitude,
      location_longitude AS longitude, transaction_status AS transactionStatus,
      transaction_type AS transactionType, adjustment_type AS adjustmentType,
      CAST(source_pid AS TEXT) AS sourcePid`);
    let ordered = `${sql} ORDER BY transaction_date DESC, pid DESC`;
    const limit = this.getEffectiveLimit();
    if (limit !== null) {
      ordered += ' LIMIT ?';
      values.push(limit);
    }

    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    for (const row of iterateRows<TransactionRow>(this.db.prepare(ordered), ...values)) {
      yield this.createRecord(this.transactionOf(row), { account });
    }
  }

  private transactionOf(row: TransactionRow): Transaction {
    return {
      identifier: row.identifier,
      serviceIdentifier: row.serviceIdentifier ?? null,
      date: appleDate(row.date),
      amount: row.amount === null ? null : row.amount / AMOUNT_SCALE,
      currencyCode: row.currencyCode ?? null,
      merchantName: row.merchantName ?? null,
      merchantRawName: row.merchantRawName ?? null,
      // 0 is no code.
      merchantIndustryCode: row.merchantIndustryCode || null,
      merchantIndustryCategory: row.merchantIndustryCategory ?? null,
      locality: row.locality ?? null,
      administrativeArea: row.administrativeArea ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      transactionStatus: row.transactionStatus ?? null,
      transactionType: row.transactionType ?? null,
      adjustmentType: row.adjustmentType ?? null,
      card: (row.sourcePid && this.cards.get(row.sourcePid)) || null,
    };
  }

  /**
   * The cards, by transaction source. A card's own source carries what its
   * issuer sends. Each of its payment applications, one per device the card
   * is on, has a source of its own, for Apple Pay on that device.
   */
  private async loadCards(): Promise<Map<string, Card>> {
    const rows = allRows<CardRow>(
      this.db!.prepare(`
        SELECT CAST(transaction_source_pid AS TEXT) AS sourcePid, unique_id AS uniqueId,
               primary_account_identifier AS accountIdentifier,
               primary_account_suffix AS accountSuffix, organization_name AS organizationName
        FROM pass WHERE transaction_source_pid IS NOT NULL
        UNION
        SELECT CAST(a.transaction_source_pid AS TEXT), p.unique_id, p.primary_account_identifier,
               p.primary_account_suffix, p.organization_name
        FROM payment_application a JOIN pass p ON p.pid = a.pass_pid
        WHERE a.transaction_source_pid IS NOT NULL`)
    );
    const cards = new Map<string, Card>();
    const details = new Map<string, PassDetails>();
    for (const row of rows) {
      let pass = details.get(row.uniqueId);
      if (!pass) {
        pass = await this.readPass(row.uniqueId);
        details.set(row.uniqueId, pass);
      }
      cards.set(row.sourcePid, {
        uniqueId: row.uniqueId,
        accountIdentifier: row.accountIdentifier ?? null,
        accountSuffix: row.accountSuffix ?? null,
        organizationName: row.organizationName ?? null,
        ...pass,
      });
    }
    return cards;
  }

  /**
   * The card's name and kind from its `pass.json` in the `Cards` folder
   * beside the store. A copied store has none, and the card goes without.
   */
  private async readPass(uniqueId: string): Promise<PassDetails> {
    const path = join(dirname(this.config.input), 'Cards', `${uniqueId}.pkpass`, 'pass.json');
    try {
      const pass = JSON.parse(await readFile(path, 'utf8'));
      const applications: Array<{ defaultPaymentApplication?: boolean; paymentType?: unknown }> =
        Array.isArray(pass.paymentApplications) ? pass.paymentApplications : [];
      const application =
        applications.find(each => each?.defaultPaymentApplication) ?? applications[0];
      return {
        description: typeof pass.description === 'string' ? pass.description : null,
        paymentType: typeof application?.paymentType === 'string' ? application.paymentType : null,
      };
    } catch (error) {
      this.logger.verboseInfo(`Can't read a card's pass.json: ${(error as Error).message}`);
      return { description: null, paymentType: null };
    }
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      const { sql, values } = this.query('COUNT(*) AS n');
      return getRow<{ n: number }>(this.db.prepare(sql), ...values)?.n ?? null;
    } catch {
      return null;
    }
  }
}

function appleDate(seconds: number): string {
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}
