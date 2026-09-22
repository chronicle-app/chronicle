import { Help } from '@oclif/core';
import { renderSourceHelp } from '../utils/sourceHelp.js';

// Verb (or its short alias) -> canonical verb for usage text.
const SOURCE_VERBS = new Map<string, string>([
  ['extract', 'extract'],
  ['import', 'import'],
  ['e', 'extract'],
  ['i', 'import'],
]);

/**
 * Custom help so `chronicle extract <source> --help` (and import / e / i, and
 * `chronicle help extract <source>`) shows the source's extractors + flags.
 *
 * oclif renders help BEFORE a command's init() runs (main.run → helpAddition →
 * showHelp), so the dispatcher can't intercept --help itself. Hooking the help
 * layer here also means it works while per-plugin `extract:<source>` commands
 * still exist (it overrides their help too).
 */
export default class SourceHelp extends Help {
  async showHelp(argv: string[]): Promise<void> {
    let positionals = argv.filter(a => !a.startsWith('-'));
    if (positionals[0] === 'help') positionals = positionals.slice(1);

    const verb = positionals[0] ? SOURCE_VERBS.get(positionals[0]) : undefined;
    const source = positionals[1];

    if (verb && source) {
      const { PluginScanner } = await import('../plugins/PluginScanner.js');
      const candidates = (await PluginScanner.scanAllPlugins()).get(source) ?? [];
      if (candidates.length > 0) {
        process.stdout.write(`${renderSourceHelp(source, candidates, { verb })}\n`);
        return;
      }
    }

    await super.showHelp(argv);
  }
}
