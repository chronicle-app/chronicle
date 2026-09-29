import type { Delivery } from '@chronicle.app/etl';

/** How the data reaches the person writing the plugin; picks the base extractor. */
export const KINDS = {
  csv: { label: 'A CSV file', delivery: 'export', strategy: 'csv', recordType: 'rows' },
  json: { label: 'A JSON file', delivery: 'export', strategy: 'file', recordType: 'items' },
  archive: {
    label: 'An export folder (like a Takeout)',
    delivery: 'export',
    strategy: 'archive',
    recordType: 'files',
  },
  sqlite: {
    label: "An app's SQLite database on this machine",
    delivery: 'local',
    strategy: 'app-db',
    recordType: 'rows',
  },
  api: { label: 'A web API', delivery: 'api', strategy: 'api', recordType: 'items' },
  other: { label: 'Something else', delivery: 'export', strategy: 'file', recordType: 'items' },
} as const satisfies Record<
  string,
  { label: string; delivery: Delivery; strategy: string; recordType: string }
>;

export type Kind = keyof typeof KINDS;

export interface ScaffoldOptions {
  name: string;
  kind: Kind;
  /** The version of the Chronicle packages it builds against. */
  version: string;
}

export const isPluginName = (name: string) => /^[a-z][\da-z]*(?:-[\da-z]+)*$/.test(name);

const pascal = (name: string) =>
  name
    .split('-')
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('');

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The extractor's static fields, shared by every kind. */
function statics(options: ScaffoldOptions, P: string, description: string): string {
  const { delivery, strategy, recordType } = KINDS[options.kind];
  return `  static override source = '${options.name}';
  static override description = '${description}';
  static override delivery = '${delivery}' as const;
  // How the source is read, in its own words; \`--strategy\` picks it.
  static override strategy = '${strategy}';
  static override recordTypes = ['${recordType}'];
  static override default = true;
  static override defaultTransformer = ${P}Transformer;`;
}

/** The extractor for each kind: it reads the real source and yields raw records. */
function extractor(options: ScaffoldOptions, P: string): string {
  const importTransformer = `import { ${P}Transformer } from './${P}Transformer.ts';`;
  switch (options.kind) {
    case 'csv':
      return `import { CsvExtractor, configForIo } from '@chronicle.app/etl';
${importTransformer}

/** Each row of a CSV export, keyed by its header row. */
export class ${P}Extractor extends CsvExtractor {
${statics(options, P, 'Rows from a CSV export')}

  // CsvExtractor doesn't know which column is the date, so --since and --until
  // aren't applied yet: filter on your date column when you know it.
  constructor(config: any) {
    super({ ...config, ...configForIo(config), columns: true, trimColumns: true });
  }
}
`;
    case 'json':
      return `import { readFile } from 'node:fs/promises';
import { Extractor, z, type Record } from '@chronicle.app/etl';
${importTransformer}

/** Each item of a JSON export: a top-level array, or one value per line. */
export class ${P}Extractor extends Extractor<typeof ${P}Extractor> {
${statics(options, P, 'Items from a JSON export')}

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the JSON export'),
  });

  async *extract(): AsyncGenerator<Record> {
    const { input } = this.config as z.infer<typeof ${P}Extractor.schema>;
    const text = await readFile(input, 'utf8');
    // If the items sit under a key, read them from there instead.
    const items: unknown[] = text.trimStart().startsWith('[')
      ? JSON.parse(text)
      : text
          .split('\\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
    let count = 0;
    for (const item of items) {
      // --limit; 0 means no limit. Apply --since and --until on the item's date.
      if (this.shouldStopExtracting(count)) break;
      yield this.createRecord(item);
      count++;
    }
  }
}
`;
    case 'archive':
      return `import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ArchiveExtractor, type Record } from '@chronicle.app/etl';
${importTransformer}

/**
 * An export folder. It starts by listing the files in it; read the ones that
 * hold records with \`this.readArchiveJson(path)\` and yield their entries.
 */
export class ${P}Extractor extends ArchiveExtractor<typeof ${P}Extractor> {
${statics(options, P, 'Records from an export folder')}

  async *extract(): AsyncGenerator<Record> {
    const { input } = this.config as { input: string };
    let count = 0;
    for (const entry of await readdir(input, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (this.shouldStopExtracting(count)) break;
      yield this.createRecordWithArchiveContext({
        path: relative(input, join(entry.parentPath, entry.name)),
      });
      count++;
    }
  }
}
`;
    case 'sqlite':
      return `import { homedir } from 'node:os';
import { join } from 'node:path';
import { z, type Record } from '@chronicle.app/etl';
import { SqliteExtractor, iterateRows } from '@chronicle.app/etl-sqlite';
${importTransformer}

/** Rows from the app's database, opened read-only. */
export class ${P}Extractor extends SqliteExtractor<typeof ${P}Extractor> {
${statics(options, P, 'Rows from the app database')}

  // Replaces the base input with one that defaults to the app's database.
  // TODO: where the app keeps it.
  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .min(1)
      .default(join(homedir(), 'path/to/app.db'))
      .describe('Path to the database'),
  }) as any;

  async *extract(): AsyncGenerator<Record> {
    // TODO: the table that holds the records. Join the tables you need here,
    // and apply --since and --until on its date column.
    const limit = this.getEffectiveLimit() ?? -1;
    const statement = this.db!.prepare('SELECT * FROM "items" LIMIT ?');
    for (const row of iterateRows<object>(statement, limit)) {
      yield this.createRecord(row);
    }
  }
}
`;
    case 'api':
      return `import { ApiProxy, Extractor, z, type Record } from '@chronicle.app/etl';
import { resolveCredentials } from '@chronicle.app/auth';
${importTransformer}

const SOURCE = '${options.name}';

/** The API client: auth, errors, and pagination come from ApiProxy. */
class ${P}Api extends ApiProxy {
  override async initialize(): Promise<void> {}

  useToken(token: string | undefined): void {
    this.setAccessToken(token);
  }

  /** Replace with the endpoint that lists the records you want. */
  async list(): Promise<unknown[]> {
    const data = await this.request<unknown>({ url: '/' });
    return Array.isArray(data) ? data : [data];
  }
}

export class ${P}Extractor extends Extractor<typeof ${P}Extractor> {
${statics(options, P, 'Records from the API')}

  static override schema = Extractor.schema.extend({
    token: z
      .string()
      .optional()
      .describe(\`API token (default: the one saved with "chronicle auth set \${SOURCE} --token …")\`),
  });

  // TODO: the API's base URL.
  private api = new ${P}Api({ baseURL: 'https://api.example.com' });

  override async setup(): Promise<void> {
    await super.setup();
    const { token } = await resolveCredentials(
      SOURCE,
      { token: { from: ['accessToken'], optional: true } },
      { overrides: { token: (this.config as { token?: string }).token } }
    );
    this.api.useToken(token);
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const item of await this.api.list()) {
      // --limit; 0 means no limit. Pass --since and --until to the API if it filters by date.
      if (this.shouldStopExtracting(count)) break;
      yield this.createRecord(item);
      count++;
    }
  }
}
`;
    case 'other':
      return `import { Extractor, type Record } from '@chronicle.app/etl';
${importTransformer}

export class ${P}Extractor extends Extractor<typeof ${P}Extractor> {
${statics(options, P, `Records from ${options.name}`)}

  async *extract(): AsyncGenerator<Record> {
    // Read the source and yield \`this.createRecord(data)\` for each record.
    // Stop at --limit with \`this.shouldStopExtracting(count)\`.
  }
}
`;
  }
}

/** The first steps for each kind, for AGENTS.md: what the scaffold leaves to fill in. */
const START: Record<Kind, (name: string, P: string) => string> = {
  csv: (name, P) => `The extractor reads any CSV already. With the export in hand:

1. Run \`chronicle extract ${name} --input <file> --raw --preview\` to see its rows.
2. In \`src/${P}Extractor.ts\`, skip rows outside \`--since\` and \`--until\` using
   the date column.
3. Write the transformer.
`,
  json: (name, P) => `The extractor reads a top-level JSON array or JSON Lines already. With the
export in hand:

1. Run \`chronicle extract ${name} --input <file> --raw --preview\` to see its items.
2. If the items sit under a key, read them from there in \`src/${P}Extractor.ts\`,
   and skip items outside \`--since\` and \`--until\` using their date.
3. Write the transformer.
`,
  archive: (
    name,
    P
  ) => `The extractor only lists the export's files so far. With the export folder in
hand:

1. Run \`chronicle extract ${name} --input <folder> --raw --preview --limit 0\` to
   see what it holds.
2. In \`src/${P}Extractor.ts\`, read the files that hold records with
   \`this.readArchiveJson(path)\` and yield one record per entry, with a record
   type for each kind of entry (update \`recordTypes\` and the manifest).
   Skip entries outside \`--since\` and \`--until\` with
   \`this.isWithinDateRange(date)\`.
3. Write the transformer.
`,
  sqlite: (name, P) => `The extractor has placeholders marked \`TODO\` in \`src/${P}Extractor.ts\`:

1. Set the default \`input\` to where the app keeps its database. On macOS that
   is usually under \`~/Library/Application Support\`, \`~/Library/Containers\`,
   or \`~/Library/Group Containers\`. Reading another app's data may need Full
   Disk Access for the terminal.
2. List its tables (\`sqlite3 <db> .tables\`, or query \`sqlite_master\`) and
   find the one that holds the records. Replace \`items\` in the query, and join
   the tables you need. The database is opened read-only; never write to it.
3. Apply \`--since\` and \`--until\` in the query using the date column. Apps often
   store dates as seconds since 2001 (Apple) or 1970; \`@chronicle.app/etl-sqlite\`
   has helpers for Apple dates.
4. Run \`chronicle extract ${name} --raw --preview\`, then write the transformer.
`,
  api: (name, P) => `The extractor has placeholders marked \`TODO\` in \`src/${P}Extractor.ts\`:

1. Set the API's base URL, and make \`list()\` call the endpoint that returns
   the records. \`ApiProxy\` in \`@chronicle.app/etl\` handles the bearer token
   and errors; \`paginateCursor\`, \`paginateOffset\`, and \`paginateByPage\`
   handle paging.
2. If it needs a token, save one with \`chronicle auth set ${name} --token <token>\`,
   or pass \`--token\`. Never put a token in the code or in a test.
3. Pass \`--since\` and \`--until\` to the API if it filters by date, or skip
   records outside them.
4. Run \`chronicle extract ${name} --raw --preview\`, then write the transformer.
`,
  other: (name, P) => `\`extract()\` in \`src/${P}Extractor.ts\` is empty:

1. Read the source and yield \`this.createRecord(data)\` for each record. Set
   \`delivery\` to \`export\` (a file someone hands you), \`local\` (an app's own
   files, read in place), or \`api\`, and update the manifest to match.
2. Run \`chronicle extract ${name} --raw --preview\`, then write the transformer.
`,
};

/** Relative path → contents for a standalone plugin. */
export function scaffold(options: ScaffoldOptions): Record<string, string> {
  const { name, kind, version } = options;
  const P = pascal(name);
  const { delivery, strategy, recordType } = KINDS[kind];
  const run = kind === 'csv' || kind === 'json' || kind === 'archive' ? ' --input <path>' : '';
  const chronicle = [
    '@chronicle.app/etl',
    '@chronicle.app/schema',
    ...(kind === 'api' ? ['@chronicle.app/auth'] : []),
    ...(kind === 'sqlite' ? ['@chronicle.app/etl-sqlite'] : []),
  ];

  return {
    'package.json': json({
      name,
      version: '0.1.0',
      description: `A Chronicle plugin for ${name}`,
      type: 'module',
      exports: './src/index.ts',
      scripts: {
        test: 'node --experimental-strip-types --disable-warning=ExperimentalWarning --test src/*.test.js',
        typecheck: 'tsc',
      },
      peerDependencies: Object.fromEntries(chronicle.map(dep => [dep, `>=${version} <1.0.0`])),
      devDependencies: {
        ...Object.fromEntries(chronicle.map(dep => [dep, version])),
        '@types/node': '^22.13.0',
        typescript: '^5.8.0',
      },
      engines: { node: '>=22.13.0' },
      chronicle: {
        plugin: true,
        sources: {
          [name]: {
            strategies: { [strategy]: { delivery, recordTypes: [recordType], default: true } },
          },
        },
      },
    }),

    'tsconfig.json': json({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        erasableSyntaxOnly: true,
        verbatimModuleSyntax: true,
        types: ['node'],
      },
      include: ['src'],
    }),

    '.gitignore': 'node_modules/\n',

    'src/index.ts': `export { ${P}Extractor } from './${P}Extractor.ts';
export { ${P}Transformer } from './${P}Transformer.ts';
`,

    [`src/${P}Extractor.ts`]: extractor(options, P),

    [`src/${P}Transformer.ts`]: `import { ChronicleTransformer, type Record } from '@chronicle.app/etl';
import type { ActionAndChildren } from '@chronicle.app/schema';

export class ${P}Transformer extends ChronicleTransformer {
  /**
   * Turn one record into schema nodes: usually an action (what happened, and
   * when) with the thing it happened to as its object. See AGENTS.md. Until
   * this returns something, run \`chronicle extract ${name} --raw\` to see the
   * records the extractor reads.
   */
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    void record;
    return [];
  }
}
`,

    [`src/${name}.test.js`]: `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ${P}Extractor, ${P}Transformer } from './index.ts';

// A smoke test: the transformer returns schema nodes. Use a made-up record,
// never real data.
test('the transformer returns schema nodes', async () => {
  const record = {
    data: {},
    context: {},
    extraction: { source: ${P}Extractor.source, recordType: ${P}Extractor.recordTypes[0] },
  };
  const nodes = await new ${P}Transformer().transform(record);
  assert.ok(Array.isArray(nodes));
  for (const node of nodes) assert.equal(typeof node['@type'], 'string');
});
`,

    'README.md': `# ${name}

A [Chronicle](https://chronicle.app) plugin, created with \`chronicle plugins new\`.

\`\`\`sh
chronicle extract ${name}${run} --raw --preview   # the records it reads
chronicle extract ${name}${run} --preview         # what they become
\`\`\`

\`chronicle plugins remove ${name}\` stops Chronicle from running it.
`,

    'AGENTS.md': `# Working on the ${name} plugin

This is a Chronicle source plugin. It reads records from a source (extract) and
turns each into nodes in the Chronicle vocabulary (transform). Chronicle runs it
from this directory, so a change applies on the next run.

## Start here

${START[kind](name, P)}
## Layout

- \`src/${P}Extractor.ts\` reads records. Its static fields say what it reads:
  \`source\`, \`strategy\` (how it's read, picked with \`--strategy\`), \`delivery\`
  (\`export\`, \`local\`, or \`api\`), and \`recordTypes\`.
- \`src/${P}Transformer.ts\` turns each record into schema nodes.
- \`package.json\`'s \`chronicle.sources\` repeats each source's strategies,
  deliveries, record types, and default, so Chronicle can list the plugin
  without loading it. Change it whenever the extractor's static fields change.

## Run it

- \`chronicle extract ${name}${run} --raw --preview\` prints the first records as read.
- \`chronicle extract ${name}${run} --preview\` prints what the transformer makes of them.
- \`chronicle extract ${name}${run}\` prints them as JSON-LD, validated against the schema.

## The vocabulary

- Types and properties come from \`@chronicle.app/schema\`. Browse them at
  https://schema.chronicle.app, or read its TypeScript types.
- Model what happened as an action (\`BookmarkAction\`, \`ReadAction\`,
  \`ListenAction\`, \`MessageAction\`, \`CheckInAction\`, and so on) with a
  \`timestamp\`, and what it happened to as its \`object\`.
- Use an existing type and property before inventing one. Validation rejects an
  unknown \`@type\` or property.

## Keys

- Every node has an \`@key\`: the properties that identify it. Nodes with equal
  keys are the same thing, across runs and across sources.
- Something only this source identifies: \`['@type', 'source', 'sourceId']\`,
  with the source's own id.
- Something identified in the world: its global identifier, such as
  \`['url']\` for a web page.
- The person running Chronicle: add \`sameAs: ['@me']\`.

## Reading records

- Yield \`this.createRecord(data)\` for each record.
- \`--limit n\` stops after n records; \`--limit 0\` means no limit. Use
  \`this.shouldStopExtracting(count)\`.
- Honour \`--since\` and \`--until\` using the record's own date.

## Tests

\`src/${name}.test.js\` is a smoke test. Run it with \`npm install\`, then
\`npm test\`. Tests use made-up data only: never real files, contacts, accounts,
credentials, or the network.

## TypeScript

Chronicle runs these files without a build step, so:

- Use erasable syntax only: no \`enum\`, \`namespace\`, or constructor parameter
  properties. \`tsconfig.json\` enforces this.
- Relative imports end in \`.ts\`.
- Node won't run TypeScript from \`node_modules\`, so a published plugin ships
  compiled JavaScript.
`,
  };
}
