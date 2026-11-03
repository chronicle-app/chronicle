import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Args, Errors } from '@oclif/core';
import { EXIT_CODES } from '@chronicle.app/logging';
import { BaseCommand } from '../baseCommand.js';
import { count, plural, relativePath } from '../output/index.js';
import { isPathArgument } from '../plugins/scan.js';
import { IMPORT_LIMIT, STORE_FLAGS } from '../utils/importFlags.js';
import { SourceDispatchCommand } from '../utils/SourceDispatchCommand.js';

/** Extract's flags for where its records go: an import's go to the store. */
const EXTRACT_OUTPUT_FLAGS = new Set(['loader', 'output', 'headers', 'preview']);

/**
 * `chronicle import <source>` — `extract` into the store. A source runs as it
 * does for `extract`, with its strategies, kinds and flags, and the store
 * loader takes its records. A file of Chronicle JSON-LD, inline JSON, or
 * piped records import directly.
 */
export default class Import extends SourceDispatchCommand<typeof Import> {
  static override hidden = true;

  static override aliases = ['i'];

  static override summary = 'Import records from a source into your store';

  static override description =
    'Runs a source as `extract` does, and puts its records in your store instead of printing ' +
    'them. Name a file of records, or pipe them in, to import those.';

  static override usage = 'import <source|file> [type...] [flags]';

  static override examples = [
    'chronicle import shell',
    'chronicle import imessage --since 30d',
    'chronicle import records.json',
    'chronicle extract shell --limit 50 | chronicle import',
  ];

  static override args = {
    source: Args.string({
      description: 'A source, like shell or imessage, or a file of records',
      required: false,
      // Piped records are read whole in init, not taken as the source.
      ignoreStdin: true,
    }),
  };

  /** How help names each argument. */
  static argTerms = { source: '<source|file>', type: '[type...]' };

  static override flags = { ...BaseCommand.baseFlags, ...STORE_FLAGS };

  /** Piped records are read only when no source or file is named. */
  static override acceptsStdin = true;

  protected override acceptsPipedStdin(): boolean {
    return super.acceptsPipedStdin() && (this.args as { source?: string }).source === undefined;
  }

  protected override commonFlags(): Record<string, any> {
    const flags = Object.entries(super.commonFlags()).filter(
      ([name]) => !EXTRACT_OUTPUT_FLAGS.has(name)
    );
    return { ...Object.fromEntries(flags), ...STORE_FLAGS, limit: IMPORT_LIMIT };
  }

  /** The source's run, with the store as its loader and its destination. */
  protected override async runSelected(): Promise<any> {
    const { runExtraction } = await import('../utils/runExtraction.js');
    const { resolveDbPath } = await import('../persistence/store.js');
    const flags = { ...this.flags, loader: 'store', output: resolveDbPath(this.flags.db) };
    return runExtraction(this.selectedExtractor, flags, this.flagSources);
  }

  /**
   * A file, inline JSON, or piped records: import them. A path that isn't
   * there is a missing file; any other name is a source that isn't installed,
   * as for `extract`.
   */
  protected async handleNonSource(positional: string | undefined): Promise<void> {
    const inline = /^\s*[[{]/.test(positional ?? '');
    if (positional !== undefined && !inline && !existsSync(positional)) {
      if (isPathArgument(positional) || /\.jsonl?$/i.test(positional)) {
        this.fail(`No file at ${positional}`, { exitCode: EXIT_CODES.input });
      }
      return this.installPrompt(positional);
    }

    let raw: string;
    if (positional === undefined) raw = BaseCommand.stdin ?? '';
    else if (inline) raw = positional;
    else {
      try {
        raw = readFileSync(positional, 'utf8');
      } catch (error) {
        this.failFrom(error, `Couldn't read ${positional}`);
      }
    }
    if (raw.trim() === '') {
      this.fail(positional ? `${positional} is empty` : 'Nothing to import', {
        hint: 'Name a source, like `chronicle import shell`, or a file of records.',
      });
    }

    const { parsePayloadStream, processEventBatch } = await import('@chronicle.app/persistence');
    let payloads: unknown[];
    try {
      payloads = parsePayloadStream(raw);
    } catch (error) {
      this.fail(
        `Couldn't read the records as JSON: ${error instanceof Error ? error.message : error}`,
        { exitCode: EXIT_CODES.input }
      );
    }
    if (payloads.length === 0) this.fail('No records to import', { exitCode: EXIT_CODES.input });

    const { openStore } = await import('../persistence/store.js');
    const store = openStore(this.flags.db);
    const rejected: string[] = [];
    let result;
    try {
      result = await processEventBatch(store.db, payloads, {
        blobs: store.blobs,
        readFile: path => readFile(path),
        onOutcome(outcome, index) {
          if (!outcome.ok) rejected.push(`Record ${index + 1}: ${outcome.error.message}`);
        },
      });
    } finally {
      store.close();
    }

    for (const message of rejected.slice(0, 5)) this.logger.error(message);
    if (rejected.length > 5) this.logger.error(`… and ${count(rejected.length - 5)} more`);
    const { created, duplicate, failed } = result;
    this.logger.emit({
      level: failed > 0 ? 'error' : 'info',
      kind: 'summary',
      message: [
        `Imported ${count(payloads.length)} ${plural('records', payloads.length)} into ${relativePath(store.path)}: ${count(created)} new`,
        `${count(duplicate)} already there`,
        ...(failed > 0 ? [`${count(failed)} rejected`] : []),
      ].join(', '),
    });
    this.logger.flush();
    if (failed > 0) throw new Errors.ExitError(EXIT_CODES.input);
  }
}
