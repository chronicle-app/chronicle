import { pathToFileURL } from 'node:url';
import type { OutputEvent } from '@chronicle.app/logging';
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
import { THEMES, tokens } from './tokens.js';

/**
 * Every block and a fixed set of events, through every sink, in every theme,
 * at three widths. `npm run gallery -w @chronicle.app/cli` prints it; the
 * output tests check it.
 */

export const WIDTHS = [40, 80, 120];

const time = new Date(2026, 0, 2, 9, 30, 5);
const run = { id: 'run-1', source: 'shell', strategy: 'history' };

const done: SummaryFields = {
  title: 'shell · history',
  counts: { commands: 1240 },
  records: 1240,
  durationMs: 1700,
  output: 'out.json',
};

const failed: SummaryFields = {
  title: 'claude-code · sessions',
  counts: { messages: 3120, sessions: 48 },
  records: 3168,
  written: 3400,
  skipped: 12,
  failed: 5,
  durationMs: 187_000,
};

const running: ProgressFields = {
  title: 'shell · history',
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
  event({ level: 'info', kind: 'summary', scope: 'runner', message: 'finished run', fields: done }),
  event({
    level: 'info',
    kind: 'hint',
    scope: 'runner',
    message: 'stopped at --limit 100',
    hint: { action: 'pass --limit 0 to extract everything' },
    fields: { limit: 100 },
  }),
];

export interface Section {
  title: string;
  /** The width the section was given; JSON lines don't have one. */
  width?: number;
  format?: LogFormat;
  lines: string[];
}

/** Every block at `width` in `theme`, colored. */
function blocks(theme: string, width: number): string[] {
  const t = tokens({ theme, color: true });
  return [
    heading('Sources', t, width),
    ...list(['shell · history', 'claude-code · sessions', 'imessage · chat-db'], t, width),
    summary(done, t, width),
    summary(failed, t, width),
    ...hint('stopped at --limit 100', 'pass --limit 0 to extract everything', t, width).split('\n'),
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
      sections.push({ title: `blocks · ${theme} · ${width}`, width, lines: blocks(theme, width) });
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
  return sections;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const { title, width, lines } of gallery()) {
    const rule = '─'.repeat(width ?? 80);
    process.stdout.write(`\n${title}\n${rule}\n${lines.join('\n')}\n`);
  }
}
