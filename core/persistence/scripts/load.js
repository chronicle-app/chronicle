// Fold Chronicle JSON-LD into a store, then print how many rows its main tables hold.
//   npm run store:load -- <payloads> [store.db]
// The payloads are what `chronicle extract` writes: a JSON object, an array, JSONL, or
// concatenated JSON. Paths are relative to where npm was run, and the store is created when
// it doesn't exist.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePayloadStream, processEventBatch } from '@chronicle.app/persistence';
import { openDatabase } from '@chronicle.app/persistence/node';

const TABLES = [
  'assertions',
  'actions',
  'entities',
  'sourced_entities',
  'observations',
  'properties',
];
const SHOWN_REJECTIONS = 5;

async function load(file, path) {
  const payloads = parsePayloadStream(readFileSync(file, 'utf8'));
  const store = openDatabase({ path });
  try {
    const rejections = [];
    const started = performance.now();
    const result = await processEventBatch(store.db, payloads, {
      onOutcome(outcome) {
        if (!outcome.ok) rejections.push(outcome.error.message);
      },
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      `${payloads.length} payloads in ${seconds} s: ${result.created} new, ` +
        `${result.duplicate} already stored, ${result.failed} rejected`
    );
    for (const message of rejections.slice(0, SHOWN_REJECTIONS)) console.log(`  ${message}`);
    if (rejections.length > SHOWN_REJECTIONS) {
      console.log(`  and ${rejections.length - SHOWN_REJECTIONS} more`);
    }
    console.log();
    for (const table of TABLES) {
      const { n } = store.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get();
      console.log(`${table.padEnd(18)} ${n}`);
    }
  } finally {
    store.close();
  }
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const [file, path = 'store.db'] = process.argv.slice(2);
if (file === undefined) {
  console.error('Usage: npm run store:load -- <payloads> [store.db]');
  process.exitCode = 1;
} else {
  await load(resolve(cwd, file), resolve(cwd, path));
}
