import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonSchema } from '@chronicle.app/schema';
import { getICloudAccount, buildICloudPersonSchema, ContactCache } from '../dist/index.js';

test('account lookup picks the logged-in account, passes paths as arguments, and falls back', async () => {
  const calls = [];
  const account = await getICloudAccount({
    platform: 'darwin',
    homeDir: '/fixture/quoted " $ home',
    run(command, args) {
      calls.push([command, args]);
      return JSON.stringify({
        Accounts: [
          { AccountID: 'old@example.com', LoggedIn: false },
          { AccountID: 'me@example.com', AccountDSID: 123, LoggedIn: true },
        ],
      });
    },
  });
  assert.equal(account.email, 'me@example.com');
  assert.equal(account.dsid, '123');
  assert.equal(
    calls[0][1].at(-1),
    '/fixture/quoted " $ home/Library/Preferences/MobileMeAccounts.plist'
  );
  const person = await buildICloudPersonSchema(account);
  assert.equal(person.sourceId, '123');
  assert.deepEqual(person.sameAs, ['@me']);

  // Without the plist, `defaults` output is piped to plutil rather than interpolated.
  let step = 0;
  const fallback = await getICloudAccount({
    platform: 'darwin',
    run(command, args, input) {
      step++;
      if (step === 1) throw new Error('missing plist');
      if (step === 2) {
        assert.equal(command, '/usr/bin/defaults');
        return 'fixture-plist';
      }
      assert.equal(input, 'fixture-plist');
      return JSON.stringify([{ AccountID: 'fallback@example.com', LoggedIn: '1' }]);
    },
  });
  assert.equal(fallback.email, 'fallback@example.com');

  assert.equal(
    await getICloudAccount({
      platform: 'linux',
      run() {
        throw new Error('must not run');
      },
    }),
    null
  );
  assert.equal(
    await getICloudAccount({
      platform: 'darwin',
      run() {
        throw new Error('denied');
      },
    }),
    null
  );

  // Without a readable account, the self is still a valid Person linked to @me.
  const self = {
    '@type': 'Person',
    source: 'icloud',
    '@key': ['@type', 'source'],
    sameAs: ['@me'],
  };
  assert.deepEqual(await buildICloudPersonSchema(null), self);
  const looked = await buildICloudPersonSchema(undefined, {
    platform: 'darwin',
    run() {
      throw new Error('denied');
    },
  });
  assert.deepEqual(looked, self);
  assert.deepEqual(PersonSchema.parse(looked), self);
});

test('read-only contact cache combines databases and resolves email, phone and ambiguous names', t => {
  const dir = mkdtempSync(join(tmpdir(), 'contacts-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = [join(dir, 'first.db'), join(dir, 'second.db')];
  for (const [i, file] of paths.entries()) {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE ZABCDRECORD (Z_PK INTEGER, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT, ZEXTERNALUUID TEXT);
      CREATE TABLE ZABCDEMAILADDRESS (ZOWNER INTEGER, ZADDRESS TEXT);
      CREATE TABLE ZABCDPHONENUMBER (ZOWNER INTEGER, ZFULLNUMBER TEXT);
      INSERT INTO ZABCDRECORD VALUES (1, 'Pat', 'Example', NULL, 'contact-${i}');
      INSERT INTO ZABCDEMAILADDRESS VALUES (1, 'pat${i}@example.com');`);
    if (i === 0) db.exec("INSERT INTO ZABCDPHONENUMBER VALUES (1, '+1 (416) 555-0123');");
    db.close();
  }
  const before = paths.map(file => readFileSync(file));
  const cache = new ContactCache(paths);
  assert.equal(cache.lookupByEmail('PAT1@example.com').id, 'contact-1');
  assert.equal(cache.lookupByPhone('+14165550123').id, 'contact-0');
  assert.equal(cache.lookupByName('Pat Example'), null);
  assert.equal(cache.lookupByName('Pat Example', { preferPhone: true }).id, 'contact-0');
  assert.equal(cache.getAllContactsWithEmails().length, 2);
  assert.deepEqual(
    paths.map(file => readFileSync(file)),
    before
  );
  // An empty cache must not fall back to the host's own contacts.
  assert.equal(new ContactCache([]).lookupByHandle('nobody@example.com'), null);
});
