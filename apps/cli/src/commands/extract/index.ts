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

  static override summary = 'Pull a source to stdout as Chronicle JSON-LD';

  static override description = `Each source has its own strategies, record kinds, and flags:
  chronicle extract <source> --help   (or: chronicle extract help <source>)
  chronicle extract <source> --list-types
See every source with: chronicle sources --all`;

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
      hint: 'name one: `chronicle extract shell` · `chronicle sources` lists them',
    });
  }
}
