import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BaseCommand } from '../../baseCommand.js';
import { PluginScanner } from '../../plugins/PluginScanner.js';
import { getTheme } from '../../theme.js';

export default class Plugins extends BaseCommand<typeof Plugins> {
  static override description = 'List installed plugins, their versions, and where each was found';

  static override examples = [
    'chronicle plugins',
    'chronicle plugins install lastfm',
    'chronicle plugins add ./my-source',
  ];

  async run(): Promise<void> {
    const theme = getTheme(this.flags.theme);
    const plugins = await PluginScanner.findChroniclePlugins();
    const rows = await Promise.all(
      plugins.map(async p => {
        if (p.file) return { ...p, version: '' };
        const pkg = JSON.parse(await fs.readFile(path.join(p.path, 'package.json'), 'utf8'));
        return { ...p, version: String(pkg.version ?? '') };
      })
    );
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const width = Math.max(...rows.map(r => `${r.name} ${r.version}`.length));
    for (const r of rows) {
      const label = `${r.name} ${r.version}`.padEnd(width);
      const where = r.origin === 'local' ? `local  ${r.file ?? r.path}` : r.origin;
      this.log(`${theme.text(label)}  ${theme.textDim(where)}`);
    }
  }
}
