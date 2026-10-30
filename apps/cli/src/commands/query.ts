import { existsSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { EXIT_CODES } from '@chronicle.app/logging';
import { BaseCommand } from '../baseCommand.js';
import { relativePath } from '../output/index.js';

/**
 * `chronicle query <cql>` — a CQL query against the store. Matches print as
 * JSONL, one light row each: an entity's types, name and current values, or
 * an action's type, time, source and role entities.
 */
export default class Query extends BaseCommand<typeof Query> {
  static override hidden = true;

  static override aliases = ['q'];

  static override summary = 'Query your store';

  static override description =
    'Prints each match as a line of JSON: actions newest first, entities in the order they were ' +
    'stored. An entity shows its types, name and current values; an action shows its type, time ' +
    'and source, and the entities in each role.';

  static override examples = [
    "chronicle query 'type:Book'",
    "chronicle query 'type:MessageAction timestamp:2024' --limit 10",
    "chronicle query 'type:Person' --count",
  ];

  static override args = {
    cql: Args.string({ description: 'The query, in CQL', required: true }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    db: Flags.string({
      helpValue: '<path>',
      summary: 'The store to query. The default is in your Chronicle data folder.',
    }),
    limit: Flags.integer({
      char: 'l',
      default: 100,
      helpValue: '<n>',
      min: 1,
      summary: 'The most matches to print',
    }),
    cursor: Flags.string({
      helpValue: '<cursor>',
      summary: 'Start after the last page, from the cursor its hint gave',
    }),
    count: Flags.boolean({
      default: false,
      summary: 'Print how many match instead of the matches',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Query);

    // Parse first, so a malformed query fails before the store opens.
    const { parse } = await import('@chronicle.app/cql');
    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(args.cql);
    } catch (error) {
      this.fail(`Couldn't parse the query: ${error instanceof Error ? error.message : error}`);
    }

    const { openStore, resolveDbPath } = await import('../persistence/store.js');
    const path = resolveDbPath(flags.db);
    if (!existsSync(path)) {
      this.fail(`No store at ${relativePath(path)}`, {
        exitCode: EXIT_CODES.input,
        hint: 'Run `chronicle import <source>` to make one.',
      });
    }

    const { queryCount, queryPage, serializeRows } = await import('@chronicle.app/persistence');
    const store = openStore(flags.db, { readonly: true });
    try {
      if (flags.count) {
        this.log(String(queryCount(store.sqlite, ast).count));
        return;
      }
      const page = queryPage(store.sqlite, ast, { limit: flags.limit, cursor: flags.cursor });
      for (const row of serializeRows(store.db, page.target, page.ids)) {
        this.log(JSON.stringify(row));
      }
      if (page.ids.length === 0) this.logger.info('Nothing matches');
      if (page.nextCursor !== undefined) {
        this.hint('More match.', `Use \`--cursor '${page.nextCursor}'\` for the next page.`);
      }
    } catch (error) {
      this.failFrom(error, "Couldn't run the query");
    } finally {
      store.close();
    }
  }
}
