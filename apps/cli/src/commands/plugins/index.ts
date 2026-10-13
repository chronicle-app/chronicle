import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BaseCommand } from '../../baseCommand.js';
import { PluginScanner } from '../../plugins/PluginScanner.js';
import { relativePath, stdoutWidth, table, tokens } from '../../output/index.js';

export default class Plugins extends BaseCommand<typeof Plugins> {
  static override description = 'List the installed plugins and where each one is';

  static override examples = [
    'chronicle plugins',
    'chronicle plugins install lastfm',
    'chronicle plugins add ./my-source',
  ];

  async run(): Promise<void> {
    const plugins = await PluginScanner.findChroniclePlugins();
    const rows = await Promise.all(
      plugins.map(async p => {
        if (p.file) return { ...p, version: '' };
        const pkg = JSON.parse(await fs.readFile(path.join(p.path, 'package.json'), 'utf8'));
        return { ...p, version: String(pkg.version ?? '') };
      })
    );
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    const { lines } = table(
      {
        headings: ['plugin', 'version', 'from'],
        cells: rows.map(r => [
          r.name,
          r.version,
          r.origin === 'local' ? `local, ${relativePath(r.file ?? r.path)}` : r.origin,
        ]),
        muted: [false, false, true],
      },
      t,
      stdoutWidth()
    );
    for (const line of lines) this.log(line);
  }
}
