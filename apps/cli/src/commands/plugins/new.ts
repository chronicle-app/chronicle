import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { findEntry, loadCatalog } from '../../plugins/catalog.js';
import { addLocalPlugin } from '../../plugins/local.js';
import { KINDS, type Kind, isPluginName, scaffold } from '../../plugins/scaffold.js';
import { getTheme } from '../../theme.js';

export default class PluginsNew extends BaseCommand<typeof PluginsNew> {
  static override description =
    'Create a plugin of your own for a source, and run it from where it is';

  static override examples = [
    'chronicle plugins new my-source',
    'chronicle plugins new my-source --from csv',
  ];

  static override args = {
    name: Args.string({ description: 'The plugin and source name, in kebab-case', required: true }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    from: Flags.string({
      summary: 'How the data reaches you (asked when omitted)',
      options: Object.keys(KINDS),
    }),
    dir: Flags.string({ summary: 'Where to create it (default: ./<name>)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginsNew);
    const theme = getTheme(flags.theme);
    const { name } = args;

    if (!isPluginName(name)) {
      this.error(`"${name}" isn't a plugin name. Use lowercase words joined by hyphens.`);
    }
    if (findEntry(await loadCatalog(), name)) {
      this.error(
        `${name} is already a Chronicle plugin. Choose another name, or add a copy of ` +
          'its directory with "chronicle plugins add <path>".'
      );
    }
    const dir = path.resolve(flags.dir ?? name);
    if (existsSync(dir)) {
      if (!(await fs.stat(dir)).isDirectory()) {
        this.error(`${dir} already exists and isn't a folder.`);
      }
      if ((await fs.readdir(dir)).length > 0) {
        this.error(`${dir} already exists and isn't empty.`);
      }
    }

    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const kind = (flags.from ?? (await this.askKind(interactive))) as Kind;

    for (const [file, contents] of Object.entries(
      scaffold({ name, kind, version: this.config.version })
    )) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), contents);
    }
    try {
      await addLocalPlugin(this.config.configDir, dir);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }

    this.log(`${theme.success('Created and added')} ${theme.textBold(name)} ${theme.textDim(dir)}`);
    this.log('');
    this.log(
      `${theme.textDim('Next: follow')} ${path.join(dir, 'AGENTS.md')}${theme.textDim(
        ', or point a coding agent at it.'
      )}`
    );
  }

  private async askKind(interactive: boolean): Promise<string> {
    if (!interactive) {
      this.error(`Say how the data reaches you with --from (${Object.keys(KINDS).join(', ')}).`);
    }
    const { inkSelect } = await import('../../components/InkSelect.js');
    const { value, cancelled } = await inkSelect(
      'How does the data reach you?',
      Object.entries(KINDS).map(([value, { label }]) => ({ label, value }))
    );
    if (cancelled) this.exit(130);
    return value;
  }
}
