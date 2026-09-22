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

  static override description = 'Pull a source to stdout as Chronicle JSON-LD';

  static override examples = [
    'chronicle extract spotify',
    'chronicle extract spotify --type listens',
    'chronicle extract shell --loader json',
    'chronicle extract spotify --list-types',
  ];

  protected readonly defaultLoaderName = 'json' as const;

  protected async handleNonSource(positional: string | undefined): Promise<void> {
    if (positional) this.installPrompt(positional);
    this.error('Specify a source, e.g. `chronicle extract spotify`. See `chronicle sources`.');
  }
}
