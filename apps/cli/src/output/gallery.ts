import { pathToFileURL } from 'node:url';
import type { Command } from '@oclif/core';
import type { OutputEvent } from '@chronicle.app/logging';
import { commandHelp, rootHelp, sourceHelp, topicHelp } from '../help/render.js';
import type { SourceListing } from '../plugins/catalog.js';
import { sourcesTable } from '../utils/sourcesTable.js';
import {
  caption,
  card,
  heading,
  hint,
  list,
  summary,
  table,
  type SummaryFields,
} from './blocks.js';
import { progress, type ProgressFields } from './live.js';
import { createSink, LOG_FORMATS, type LogFormat } from './sinks.js';
import { THEMES, plainTokens, tokens, type Tokens } from './tokens.js';

/**
 * Every block and a fixed set of events, through every sink, in every theme,
 * at three widths. `npm run gallery -w @chronicle.app/cli` prints it; the
 * output tests check it.
 */

export const WIDTHS = [40, 80, 120];

const time = new Date(2026, 0, 2, 9, 30, 5);
const run = { id: 'run-1', source: 'shell', strategy: 'history' };

const done: SummaryFields = {
  title: 'shell · commands',
  counts: { commands: 1240 },
  records: 1240,
  durationMs: 1700,
  output: 'out.json',
};

const failed: SummaryFields = {
  title: 'claude-code',
  counts: { messages: 3120, sessions: 48 },
  records: 3168,
  written: 3400,
  skipped: 12,
  failed: 5,
  durationMs: 187_000,
};

const running: ProgressFields = {
  title: 'shell · commands',
  processed: 420,
  total: 1240,
  counts: { commands: 420 },
  current: 'git status --short',
  elapsedMs: 4200,
};

const event = (e: Omit<OutputEvent, 'time' | 'run'>): OutputEvent => ({ time, run, ...e });

/** Synthetic events covering every kind and level. */
export const EVENTS: OutputEvent[] = [
  event({
    level: 'debug',
    kind: 'progress',
    scope: 'runner',
    message: '420 records',
    fields: running,
    sensitive: ['current'],
  }),
  event({
    level: 'debug',
    kind: 'diagnostic',
    scope: 'runner',
    message: 'Pre-extracted 1240 records',
  }),
  event({
    level: 'info',
    kind: 'notice',
    scope: 'shell.history',
    message: 'Reading the history file',
    fields: { lines: 1240 },
    sensitive: ['lines'],
  }),
  event({
    level: 'warn',
    kind: 'notice',
    scope: 'claude-code.sessions',
    message: 'unparseable line skipped',
    fields: { file: 'session-0001.jsonl', line: 42 },
    sensitive: ['file', 'line'],
  }),
  // Chatter once per record for 15 seconds: three examples, then roll-ups.
  ...Array.from({ length: 30 }, (_, i) => ({
    ...event({
      level: 'debug',
      kind: 'diagnostic',
      scope: 'arena.api',
      message: `Generated ${1 + (i % 2)} actions from arena record`,
      fields: { recordType: i % 3 === 0 ? 'connections' : 'blocks' },
    }),
    time: new Date(time.getTime() + i * 500),
  })),
  ...Array.from({ length: 5 }, (_, i) =>
    event({
      level: 'error',
      kind: 'error',
      scope: 'runner',
      message: `Extraction error: Schema validation error: record ${i + 1} is missing a timestamp`,
      key: 'record.validation',
    })
  ),
  event({
    level: 'error',
    kind: 'error',
    scope: 'runner',
    message: 'Extraction cleanup failed: two things went wrong\nthe first\nthe second',
    error: { code: 'TEARDOWN' },
  }),
  event({
    level: 'error',
    kind: 'summary',
    scope: 'runner',
    message: 'failed run',
    fields: failed,
  }),
  // A run of several kinds says which it reads, and what it leaves out.
  event({ level: 'info', kind: 'notice', scope: 'cli', message: 'Extracting stars, gists' }),
  event({
    level: 'info',
    kind: 'hint',
    scope: 'cli',
    message: 'Also available: commits, issues. Use `-t all` to get everything.',
  }),
  // A section of a walkthrough a person follows along with.
  event({
    level: 'info',
    kind: 'guide',
    scope: 'auth',
    message: 'Step 2 of 3: Set up the sign-in screen',
    guide: {
      text: ['This is the Google page you’ll see when you sign in.'],
      steps: ['Click Get started.', 'Pick External for the audience and click Next.'],
    },
  }),
  // A usage error, with what to do about it.
  event({
    level: 'error',
    kind: 'error',
    scope: 'cli',
    message: 'github has no record type "likes"',
    error: { code: 'unknown-record-type', exitCode: 2 },
    hint: { action: 'Run `chronicle extract github --list-types` to see what it has.' },
  }),
  // Cancelling is a choice: said plainly.
  event({ level: 'info', kind: 'notice', scope: 'cli', message: 'Extraction cancelled' }),
  event({ level: 'info', kind: 'summary', scope: 'runner', message: 'finished run', fields: done }),
  event({
    level: 'info',
    kind: 'hint',
    scope: 'runner',
    message: 'Showing the first 100 of 1,240. Use `--limit 0` for all.',
    fields: { limit: 100 },
  }),
];

/** A command as oclif caches it, for its help screen. */
const command = {
  id: 'sources',
  summary: 'List the sources and the record types each has',
  aliases: [],
  hidden: false,
  hiddenAliases: [],
  args: {},
  flags: {
    all: {
      name: 'all',
      type: 'boolean',
      summary: 'Include legacy sources for services that no longer exist',
      helpGroup: 'FILTER',
    },
    delivery: {
      name: 'delivery',
      type: 'option',
      summary: 'Only sources that arrive this way',
      options: ['export', 'api', 'local', 'direct'],
      helpGroup: 'FILTER',
    },
    format: {
      name: 'format',
      type: 'option',
      summary: 'How to print the list',
      options: ['table', 'json', 'csv'],
      default: 'table',
      helpGroup: 'OUTPUT',
    },
    preset: {
      name: 'preset',
      char: 'p',
      type: 'option',
      summary: 'Presets to use, comma-separated',
      helpValue: '<name,...>',
      helpGroup: 'GLOBAL',
    },
    'log-format': {
      name: 'log-format',
      type: 'option',
      summary:
        'How messages print: pretty at a terminal, plain otherwise, json for another program',
      options: ['pretty', 'plain', 'json'],
      helpGroup: 'GLOBAL',
    },
  },
  examples: [
    'chronicle sources --all',
    {
      description: 'List the sources you can extract without signing in.',
      command: 'chronicle sources --delivery local',
    },
  ],
} as unknown as Command.Cached;

const listing = (source: string, extra: Partial<SourceListing> = {}): SourceListing => ({
  source,
  plugin: source,
  package: `@chronicle.app/${source}`,
  tier: 'core',
  summary: `${source} records, with a summary long enough to be cut at narrow widths`,
  installed: true,
  origin: 'bundled',
  strategies: [{ name: 'api', delivery: 'api', recordTypes: ['stars'], default: true }],
  platforms: [],
  requires: [],
  supported: true,
  ...extra,
});

/** Every help screen, and the sources table, at `width` with `t`. */
function help(t: Tokens, width: number): string[] {
  return [
    rootHelp(
      {
        version: '1.2.3',
        summary: 'Extract your digital history into a shared vocabulary.',
        commands: [
          { name: 'auth', summary: 'Sign in to providers and manage stored credentials' },
          { name: 'extract', summary: 'Extract records from a source as Chronicle JSON-LD' },
          { name: 'autocomplete', summary: 'Set up tab completion for your shell' },
        ],
      },
      t,
      width
    ),
    topicHelp(
      {
        name: 'auth',
        description: 'Sign in to providers and manage stored credentials',
        commands: [
          { name: 'auth list', summary: 'List the providers with stored credentials' },
          { name: 'auth login', summary: 'Sign in to a provider in the browser' },
        ],
      },
      t,
      width
    ),
    commandHelp(
      command,
      { commands: [{ name: 'sources info', summary: 'Show a source' }] },
      t,
      width
    ),
    sourceHelp(
      {
        source: 'github',
        verb: 'extract',
        strategies: [
          { name: 'api', delivery: 'api', default: true, recordTypes: ['stars', 'commits'] },
          { name: 'archive', delivery: 'export', default: false, recordTypes: ['issues'] },
        ],
        flags: [{ name: 'username', type: 'option', summary: 'Whose activity to extract' }],
        common: [
          {
            name: 'limit',
            char: 'l',
            type: 'option',
            helpValue: '<n>',
            summary: 'The most records to extract. Use 0 for all.',
            default: 100,
          },
          {
            name: 'loader',
            type: 'option',
            options: ['csv', 'json', 'preview', 'table', 'yaml'],
            summary: 'How to write the records',
            default: 'json',
          },
        ],
        defaults: ['stars'],
      },
      t,
      width
    ),
    ...sourcesTable(
      [
        listing('github'),
        listing('imessage', { platforms: ['darwin'], supported: false }),
        listing('moves-app', { tier: 'legacy', installed: false, origin: null }),
      ],
      t,
      width
    ),
  ].flatMap(screen => screen.split('\n'));
}

export interface Section {
  title: string;
  /** The width the section was given; JSON lines don't have one. */
  width?: number;
  format?: LogFormat;
  /** False when the section was drawn without color. */
  color?: boolean;
  lines: string[];
}

/** Every block at `width` in `theme`, colored. */
function blocks(theme: string, width: number): string[] {
  const t = tokens({ theme, color: true });
  return [
    heading('Sources', t, width),
    ...list(['shell · history', 'claude-code · sessions', 'imessage · chat-db'], t, width),
    ...summary(done, t, width).split('\n'),
    ...summary(failed, t, width).split('\n'),
    ...hint('Showing the first 100. Use `--limit 0` for all.', undefined, t, width).split('\n'),
    ...progress(running, t, width, 3),
    ...progress({ ...running, total: 0 }, t, width, 7),
    ...progress({ ...running, phase: 'reading', total: 0 }, t, width, 11),
    ...caption(
      [
        ['', 'ExecuteAction'],
        ['agent', 'synthetic-user'],
        ['host', 'workstation'],
      ],
      t,
      width
    ),
    ...card(
      'ExecuteAction',
      [
        ['timestamp', '2026-01-02 09:30'],
        ['object', 'git status --short'],
        ['agent', 'synthetic-user'],
      ],
      t,
      width
    ),
    ...table(
      {
        headings: ['timestamp', 'object', 'exit'],
        cells: [
          ['2026-01-02 09:30', 'git status --short', '0'],
          ['2026-01-02 09:31', 'npm run build -w @chronicle.app/cli --if-present', '1'],
        ],
        numeric: [false, false, true],
        muted: [true, false, false],
      },
      t,
      width
    ).lines,
  ];
}

export function gallery(): Section[] {
  const sections: Section[] = [];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      sections.push(
        { title: `blocks · ${theme} · ${width}`, width, lines: blocks(theme, width) },
        {
          title: `help · ${theme} · ${width}`,
          width,
          lines: help(tokens({ theme, color: true }), width),
        }
      );
      for (const format of LOG_FORMATS) {
        let text = '';
        const sink = createSink({
          format,
          level: 'debug',
          theme,
          width,
          color: true,
          write(chunk) {
            text += chunk;
          },
        });
        for (const e of EVENTS) sink.emit(e);
        sink.flush?.();
        sections.push({
          title: `${format} · ${theme} · ${width}`,
          width: format === 'json' ? undefined : width,
          format,
          lines: text.split('\n').slice(0, -1),
        });
      }
    }
  }
  for (const width of WIDTHS) {
    sections.push({
      title: `help · no color · ${width}`,
      width,
      color: false,
      lines: help(plainTokens, width),
    });
  }
  return sections;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const { title, width, lines } of gallery()) {
    const rule = '─'.repeat(width ?? 80);
    process.stdout.write(`\n${title}\n${rule}\n${lines.join('\n')}\n`);
  }
}
