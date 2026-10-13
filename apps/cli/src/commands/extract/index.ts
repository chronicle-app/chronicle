import { SourceDispatchCommand } from '../../utils/SourceDispatchCommand.js';

/**
 * `chronicle extract <source>` — the native source dispatcher (stdout default).
 *
 * Coexists with any plugin-shipped `extract:<source>` command, which oclif
 * resolves first for that source; this command handles every other discoverable
 * source. Routing, multi-strategy selection, and dynamic per-source flags all
 * live in {@link SourceDispatchCommand}.
 */
export default class Extract extends SourceDispatchCommand<typeof Extract> {
  static override aliases = ['e'];

  static override summary = 'Extract records from a source as Chronicle JSON-LD';

  static override description =
    'Records print to stdout unless you pass `--output`. Each source has its own strategies, ' +
    "record types, and flags: run `chronicle extract shell --help` to see a source's, and " +
    '`chronicle sources` to see every source.';

  static override usage = 'extract <source> [type...] [flags]';

  static override examples = [
    'chronicle extract shell --limit 10',
    'chronicle extract things-todo --type tasks',
    'chronicle extract claude-code --loader yaml --output sessions.yaml',
    'chronicle extract arena --help',
    'chronicle extract arena --list-types',
  ];

  protected readonly defaultLoaderName = 'json' as const;

  // An unknown source only gets "no source named …" or the install offer.
  protected override readonly parsesFlagsForNonSource = false;

  protected async handleNonSource(positional: string | undefined): Promise<void> {
    if (positional) return this.installPrompt(positional);
    this.fail('No source given', {
      hint: 'Name a source, like `chronicle extract shell`. Run `chronicle sources` to see them all.',
    });
  }
}
