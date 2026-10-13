import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppleWalletExtractor, AppleWalletTransformer } from '../dist/index.js';
import { account, writeWalletFixture } from './fixture.test-helper.js';

// An explicit account keeps the host's iCloud account out of the test.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-wallet-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function extract(input, config = {}) {
  const extractor = new AppleWalletExtractor({ input, account, limit: 0, ...config });
  try {
    await extractor.setup();
    return {
      records: await Array.fromAsync(extractor.extract()),
      count: await extractor.determineCount(),
    };
  } finally {
    await extractor.teardown();
  }
}

/** The transformed actions by transaction ID, without the snapshot directives. */
async function actions(dir) {
  const { records } = await extract(writeWalletFixture(dir));
  const transformer = new AppleWalletTransformer();
  const out = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) {
      assert.match(node.data['@assertedAt'], /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(node.data['@asserts'], ['*']);
      out.push(withoutDirectives(node.data));
    }
  }
  return new Map(out.map(action => [action.sourceId, action]));
}

// A snapshot source asserts every node complete at read time; the tests look
// at what the nodes say.
function withoutDirectives(node) {
  if (Array.isArray(node)) return node.map(item => withoutDirectives(item));
  if (!node || typeof node !== 'object' || node instanceof Date) return node;
  const { '@asserts': _asserts, '@assertedAt': _assertedAt, ...rest } = node;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, withoutDirectives(v)]));
}

const key = ['@type', 'source', 'sourceId'];
const me = {
  '@type': 'Person',
  '@key': key,
  source: 'icloud',
  sourceId: '1234567890',
  handle: 'you@example.com',
  sameAs: ['@me'],
};
const organization = name => ({
  '@type': 'Organization',
  '@key': ['@type', 'source', 'name'],
  source: 'apple-wallet',
  name,
});
const payAction = (sourceId, timestamp, fields) => ({
  '@type': 'PayAction',
  '@key': key,
  source: 'apple-wallet',
  sourceId,
  timestamp: new Date(timestamp),
  agent: me,
  ...fields,
});
const posting = (sourceId, amount, currency, account) => ({
  '@type': 'Posting',
  '@key': ['@type', 'source', 'sourceId', 'account.sourceId'],
  source: 'apple-wallet',
  sourceId,
  amount,
  currency,
  account,
});
const visaAccount = {
  '@type': 'FinancialAccount',
  '@key': key,
  source: 'apple-wallet',
  sourceId: 'V-0000000000000000000001',
  name: 'Example Rewards Visa',
  lastDigits: '7959',
  accountType: 'liability',
  provider: organization('Example Bank'),
  holder: me,
};
const amexAccount = {
  '@type': 'FinancialAccount',
  '@key': key,
  source: 'apple-wallet',
  sourceId: 'FAPLAB0000000000000000000000000000000000002',
  lastDigits: '1001',
  provider: organization('Example Express'),
  holder: me,
};
const transaction = (sourceId, fields) => ({
  '@type': 'Transaction',
  '@key': key,
  source: 'apple-wallet',
  sourceId,
  ...fields,
});

test('transactions become PayActions with their card and merchant, newest first', async t => {
  const byId = await actions(tempDir(t));
  // The row without an identifier is left out.
  assert.deepEqual([...byId.keys()], ['TXN-ISSUER', 'TXN-TAP', 'TXN-BARE']);

  // From the issuer: the card is keyed by the network's identifier and named
  // from its pass.json, with its default payment application's kind, and its
  // account is derived from it as a liability. The amount has four decimal
  // places in the store, and the posting is its negative.
  assert.deepEqual(
    byId.get('TXN-ISSUER'),
    payAction('TXN-ISSUER', '2025-01-01T00:05:00.000Z', {
      instrument: [
        {
          '@type': 'PaymentCard',
          '@key': key,
          source: 'apple-wallet',
          sourceId: 'V-0000000000000000000001',
          name: 'Example Rewards Visa',
          lastDigits: '7959',
          category: ['credit'],
          issuedBy: organization('Example Bank'),
          holder: me,
          account: visaAccount,
        },
      ],
      result: transaction('TXN-ISSUER', {
        amount: 69.93,
        currency: 'CAD',
        recipient: [organization('Example Café')],
        posting: [posting('TXN-ISSUER', -69.93, 'CAD', visaAccount)],
      }),
    })
  );

  // Made on this device: the card is found through its payment application
  // and has no pass.json, so neither it nor its account has a name or kind;
  // the merchant falls back to the raw name; the location has the fix and
  // the locality.
  assert.deepEqual(
    byId.get('TXN-TAP'),
    payAction('TXN-TAP', '2025-01-01T00:03:20.000Z', {
      instrument: [
        {
          '@type': 'PaymentCard',
          '@key': key,
          source: 'apple-wallet',
          sourceId: 'FAPLAB0000000000000000000000000000000000002',
          lastDigits: '1001',
          issuedBy: organization('Example Express'),
          holder: me,
          account: amexAccount,
        },
      ],
      result: transaction('TXN-TAP', {
        amount: 15.82,
        currency: 'CAD',
        recipient: [organization('EXAMPLE GROCER 1281')],
        posting: [posting('TXN-TAP', -15.82, 'CAD', amexAccount)],
      }),
      location: { '@type': 'Location', latitude: 43.65, longitude: -79.38, address: 'Toronto, ON' },
    })
  );

  // No card, merchant, currency, or fix: the transaction keeps its amount and
  // has no posting, since no account is known.
  assert.deepEqual(
    byId.get('TXN-BARE'),
    payAction('TXN-BARE', '2025-01-01T00:01:40.000Z', {
      result: transaction('TXN-BARE', { amount: 1 }),
    })
  );
});

test('extraction honours the time range and counts transactions with an id', async t => {
  const input = writeWalletFixture(tempDir(t));
  assert.equal((await extract(input)).count, 3);

  const { records, count } = await extract(input, {
    since: new Date('2025-01-01T00:02:00Z'),
    until: new Date('2025-01-01T00:04:00Z'),
  });
  // Both bounds are exclusive, the count follows them, and the raw record
  // keeps Wallet's codes.
  assert.deepEqual(
    records.map(record => record.data.identifier),
    ['TXN-TAP']
  );
  assert.equal(count, 1);
  assert.equal(records[0].data.transactionStatus, 1);
  assert.equal(records[0].data.merchantIndustryCode, 5411);
});
