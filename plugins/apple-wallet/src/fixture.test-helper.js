import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
export const JAN_1 = 757_382_400;

export const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

/**
 * A synthetic passes23.sqlite, with a Cards folder beside it, holding two
 * cards and four transactions:
 *
 * - CARD-VISA has its own transaction source, which its issuer writes to,
 *   the issuer's identifier for its account, and a pass.json with the
 *   card's name and kind.
 * - CARD-AMEX is reached only through a payment application's source, as
 *   an Apple Pay transaction made on this device is, has no pass.json, and
 *   no account identifier from its issuer.
 * - TXN-ISSUER, the newest, is on CARD-VISA from the issuer: an amount, a
 *   merchant, and no location.
 * - TXN-TAP is on CARD-AMEX with a location fix, a locality, a merchant
 *   category code, and only a raw merchant name.
 * - TXN-BARE is from a source that is no card, with no merchant, currency,
 *   or location fix (0, 0).
 * - A row with no identifier, which is left out.
 */
export function writeWalletFixture(dir) {
  const input = join(dir, 'passes23.sqlite');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE pass (pid INTEGER PRIMARY KEY, unique_id TEXT NOT NULL, organization_name TEXT,
      primary_account_identifier TEXT, primary_account_suffix TEXT, transaction_source_pid INTEGER,
      e TEXT, supports_fpan_notifications INTEGER, supports_dpan_notifications INTEGER);
    CREATE TABLE transaction_source (pid INTEGER PRIMARY KEY, identifier TEXT, type INTEGER);
    CREATE TABLE payment_application (pid INTEGER PRIMARY KEY, transaction_source_pid INTEGER,
      pass_pid INTEGER);
    CREATE TABLE payment_transaction (pid INTEGER PRIMARY KEY, source_pid INTEGER, identifier TEXT,
      service_identifier TEXT, transaction_date INTEGER NOT NULL, amount INTEGER,
      currency_code TEXT, merchant_name TEXT, merchant_raw_name TEXT,
      merchant_industry_code INTEGER, merchant_industry_category TEXT, locality TEXT,
      administrative_area TEXT, location_latitude REAL, location_longitude REAL,
      transaction_status INTEGER, transaction_type INTEGER, adjustment_type INTEGER);

    -- Pids in a real store are 64-bit values beyond Number's safe range.
    INSERT INTO transaction_source VALUES
      (-4232114809929004489, 'SOURCE-VISA', 0),
      (7802450396861492821, 'SOURCE-AMEX-DEVICE', 0);
    INSERT INTO pass VALUES
      (1, 'CARD-VISA', 'Example Bank', 'V-0000000000000000000001', '7959', -4232114809929004489,
        'ACCOUNT-VISA-1', 1, 1),
      (2, 'CARD-AMEX', 'Example Express', 'FAPLAB0000000000000000000000000000000000002', '1001',
        NULL, NULL, 0, 1);
    INSERT INTO payment_application VALUES (10, 7802450396861492821, 2);
    INSERT INTO payment_transaction VALUES
      (101, -4232114809929004489, 'TXN-ISSUER', '171066550093', ${JAN_1 + 300}, 699300, 'CAD',
        'Example Café', NULL, 0, NULL, NULL, NULL, NULL, NULL, 1, 0, 0),
      (102, 7802450396861492821, 'TXN-TAP', NULL, ${JAN_1 + 200}, 158200, 'CAD',
        NULL, 'EXAMPLE GROCER 1281', 5411, 'Grocery', 'Toronto', 'ON', 43.65, -79.38, 1, 0, 0),
      (103, 99, 'TXN-BARE', NULL, ${JAN_1 + 100}, 10000, NULL,
        '', NULL, 0, NULL, NULL, NULL, 0, 0, 1, 0, 0),
      (104, -4232114809929004489, NULL, NULL, ${JAN_1 + 400}, 500, 'CAD',
        'No ID', NULL, 0, NULL, NULL, NULL, NULL, NULL, 1, 0, 0);
  `);
  db.close();

  const card = join(dir, 'Cards', 'CARD-VISA.pkpass');
  mkdirSync(card, { recursive: true });
  writeFileSync(
    join(card, 'pass.json'),
    JSON.stringify({
      formatVersion: 1,
      passTypeIdentifier: 'paymentpass.com.apple',
      organizationName: 'Example Bank',
      description: 'Example Rewards Visa',
      cardType: 'Payment',
      primaryAccountSuffix: '7959',
      partnerAccountIdentifier: 'ACCOUNT-VISA-1',
      paymentApplications: [
        { applicationDescription: 'Visa', paymentType: 'Debit', defaultPaymentApplication: false },
        { applicationDescription: 'Visa', paymentType: 'Credit', defaultPaymentApplication: true },
      ],
    })
  );
  return input;
}
