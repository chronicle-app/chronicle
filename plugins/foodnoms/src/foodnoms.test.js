import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoodNomsExtractor, FoodNomsTransformer } from '../dist/index.js';

const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

const me = {
  '@type': 'Person',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'icloud',
  sourceId: '1234567890',
  handle: 'you@example.com',
  sameAs: ['@me'],
};

const SOUP_ID = '3F6C2A9E1B4D4C8E9A7F2D5E8B1C4A60';
const LATTE_ID = '8B1E4D7A2C9F4E3BB6A15F0D3C7E9A24';

/** A synthetic FoodNoms db.db with a built-in, a customized, and an unnamed meal slot. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'foodnoms-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'db.db');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE foodEntryRecord (id INTEGER PRIMARY KEY, entryID BLOB, date DATETIME,
      dateCreated DATETIME, dateLastUpdated DATETIME, tzID TEXT, quantity REAL, calories REAL,
      foodID TEXT, versionID TEXT, barcode TEXT, source TEXT, secondarySource TEXT, name TEXT,
      brandOwner TEXT, baseUnit TEXT, baseAmount REAL, nutrients TEXT, mealTypeID TEXT, day TEXT);
    CREATE TABLE mealTypeRecord (mealTypeID TEXT PRIMARY KEY, name TEXT, timeRangeStart TEXT,
      timeRangeEnd TEXT, sortIndex INTEGER);
    INSERT INTO mealTypeRecord VALUES ('6', 'Second breakfast', '10:00', '11:00', 5),
      ('7', '  ', NULL, NULL, 6);
  `);
  const insert = db.prepare(`
    INSERT INTO foodEntryRecord (id, entryID, date, dateCreated, dateLastUpdated, tzID, quantity,
      calories, foodID, versionID, source, name, brandOwner, baseUnit, baseAmount, nutrients,
      mealTypeID, day)
    VALUES (:id, unhex(:entryID), :date, :date, :date, 'America/Toronto', :quantity, :calories,
      :foodID, 'v1', 'local', :name, :brandOwner, :baseUnit, 1, :nutrients, :mealTypeID,
      substr(:date, 1, 10))`);
  const entry = {
    quantity: null,
    calories: null,
    brandOwner: null,
    baseUnit: null,
    nutrients: null,
  };
  for (const row of [
    {
      id: 1,
      entryID: SOUP_ID,
      date: '2025-01-02 17:30:00.000',
      quantity: 1.5,
      calories: 270,
      foodID: 'local:soup',
      name: 'Lentil soup',
      brandOwner: 'Hearth Kitchen',
      baseUnit: 'cup',
      nutrients: '{"protein":18}',
      mealTypeID: '2',
    },
    {
      id: 2,
      entryID: LATTE_ID,
      date: '2025-01-02 14:05:00.000',
      quantity: 12,
      calories: 190,
      foodID: 'openai:latte',
      name: 'Iced latte',
      baseUnit: 'fl oz',
      nutrients: 'not json',
      mealTypeID: '1',
    },
    {
      id: 3,
      entryID: 'A'.repeat(32),
      date: '2025-01-02 15:00:00.000',
      quantity: 0,
      foodID: 'local:scone',
      name: 'Scone',
      mealTypeID: '6',
    },
    {
      id: 4,
      entryID: 'B'.repeat(32),
      date: '2025-01-01 20:00:00.000',
      foodID: 'local:cake',
      name: 'Coffee cake',
      mealTypeID: '7',
    },
  ]) {
    insert.run({ ...entry, ...row });
  }
  db.close();
  return input;
}

async function records(input, config = {}) {
  const extractor = new FoodNomsExtractor({ input, account, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

test('food entries become schema-valid EatActions and DrankActions, newest first', async t => {
  const input = fixture(t);
  const rows = await records(input);
  assert.deepEqual(
    rows.map(r => r.data.id),
    [1, 3, 2, 4]
  );

  const [soup, scone, latte, cake] = rows;
  // The blob entryID becomes a dashed UUID; naive UTC dates gain a 'Z'.
  assert.equal(soup.data.entryID, '3f6c2a9e-1b4d-4c8e-9a7f-2d5e8b1c4a60');
  assert.equal(soup.data.date, '2025-01-02 17:30:00.000Z');
  assert.deepEqual(soup.data.nutrients, { protein: 18 });
  assert.equal(latte.data.nutrients, null);
  // Built-in slot ids resolve by name, a customized slot by its row, a blank one to null.
  assert.deepEqual(
    rows.map(r => r.context.mealType.name),
    ['Lunch', 'Second breakfast', 'Breakfast', null]
  );
  assert.deepEqual(scone.context.mealType, {
    id: '6',
    name: 'Second breakfast',
    timeRangeStart: '10:00',
    timeRangeEnd: '11:00',
    sortIndex: 5,
  });

  const transformer = new FoodNomsTransformer();
  // The timestamp is the extractor's date string, passed through as is.
  const [eat] = await transformer.performTransform(soup);
  assert.deepEqual(eat.data, {
    '@type': 'EatAction',
    timestamp: '2025-01-02 17:30:00.000Z',
    '@assertedAt': '2025-01-02 17:30:00.000Z',
    '@key': ['source', 'sourceId'],
    source: 'foodnoms',
    sourceId: '3f6c2a9e-1b4d-4c8e-9a7f-2d5e8b1c4a60',
    agent: me,
    object: {
      '@type': 'Meal',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'foodnoms',
      sourceId: '3f6c2a9e-1b4d-4c8e-9a7f-2d5e8b1c4a60',
      name: 'Lentil soup',
      category: ['Lunch'],
      description: 'Lunch - Brand: Hearth Kitchen - 1.5 cup - 270 calories',
    },
  });

  const [drank] = await transformer.performTransform(latte);
  assert.deepEqual(drank.data, {
    '@type': 'DrankAction',
    timestamp: '2025-01-02 14:05:00.000Z',
    '@assertedAt': '2025-01-02 14:05:00.000Z',
    '@key': ['source', 'sourceId'],
    source: 'foodnoms',
    sourceId: '8b1e4d7a-2c9f-4e3b-b6a1-5f0d3c7e9a24',
    agent: me,
    object: {
      '@type': 'Meal',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'foodnoms',
      sourceId: '8b1e4d7a-2c9f-4e3b-b6a1-5f0d3c7e9a24',
      name: 'Iced latte',
      category: ['Breakfast'],
      description: 'Breakfast - 12 fl oz - 190 calories',
    },
  });

  // An unnamed custom slot goes uncategorized; "coffee cake" matches a drink word.
  const [cakeAction] = await transformer.performTransform(cake);
  assert.equal(cakeAction.data['@type'], 'DrankAction');
  assert.deepEqual(cakeAction.data.object, {
    '@type': 'Meal',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'foodnoms',
    sourceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'Coffee cake',
  });

  // since/until are inclusive bounds on the entry date.
  const since = new Date('2025-01-02T14:05:00Z');
  const until = new Date('2025-01-02T15:00:00Z');
  assert.deepEqual(
    (await records(input, { since, until })).map(r => r.data.id),
    [3, 2]
  );
});
