// Run a CQL query against a store: how many match, and the newest page of them.
//   npm run store:query -- <store.db> '<cql>' [limit]
// The store path is relative to where npm was run. Actions print as their time, type, agent
// and object; entities as their name and types.
import { resolve } from 'node:path';
import { parse } from '@chronicle.app/cql';
import { queryCount, queryPage } from '@chronicle.app/persistence';
import { openDatabase } from '@chronicle.app/persistence/node';

function query(path, cql, limit) {
  const store = openDatabase({ path, readonly: true });
  try {
    const ast = parse(cql);
    let started = performance.now();
    const page = queryPage(store.sqlite, ast, { limit });
    const pageMs = performance.now() - started;
    started = performance.now();
    const { count } = queryCount(store.sqlite, ast);
    const countMs = performance.now() - started;

    const action = store.sqlite.prepare(
      `SELECT a.type, a.occurred_at AS at, ag.cached_name AS agent, ob.cached_name AS object
         FROM actions a
         LEFT JOIN entities ag ON ag.id = a.cached_agent_entity_id
         LEFT JOIN entities ob ON ob.id = a.cached_object_entity_id
        WHERE a.id = ?`
    );
    const entity = store.sqlite.prepare(
      `SELECT e.cached_name AS name,
              (SELECT group_concat(type, ', ') FROM entity_types WHERE entity_id = e.id) AS types
         FROM entities e WHERE e.id = ?`
    );
    for (const id of page.ids) {
      if (page.target === 'actions') {
        const row = action.get(id);
        const at = new Date(row.at).toISOString();
        console.log(`${at}  ${row.type}  ${row.agent ?? '-'} → ${row.object ?? '-'}`);
      } else {
        const row = entity.get(id);
        console.log(`${row.name ?? '(unnamed)'}  [${row.types ?? ''}]`);
      }
    }
    console.log(
      `\n${count} ${page.target} match ` +
        `(page ${pageMs.toFixed(1)} ms, count ${countMs.toFixed(1)} ms)`
    );
  } finally {
    store.close();
  }
}

const cwd = process.env.INIT_CWD ?? process.cwd();
const [path, cql, limit = '20'] = process.argv.slice(2);
if (cql === undefined) {
  console.error(`Usage: npm run store:query -- <store.db> '<cql>' [limit]`);
  process.exitCode = 1;
} else {
  query(resolve(cwd, path), cql, Number(limit));
}
