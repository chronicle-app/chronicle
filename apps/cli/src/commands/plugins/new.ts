import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { findEntry, loadCatalog } from '../../plugins/catalog.js';
import { addLocalPlugin } from '../../plugins/local.js';
import { KINDS, type Kind, isPluginName, scaffold } from '../../plugins/scaffold.js';
import { canAsk, tokens } from '../../output/index.js';

export default class PluginsNew extends BaseCommand<typeof PluginsNew> {
  static override description =
    'Create a plugin of your own for a source, and run it from where it is';

  static override examples = [
    'chronicle plugins new my-source',
    'chronicle plugins new my-source --from csv',
  ];

  static override args = {
    name: Args.string({
      description: 'The plugin and source name, in lowercase words joined by hyphens',
      required: true,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    from: Flags.string({
      summary: "How the data reaches you. You're asked when it's left out.",
      options: Object.keys(KINDS),
    }),
    dir: Flags.string({
      summary: 'The folder to create it in. The default is one named after it.',
      helpValue: '<folder>',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginsNew);
    const t = tokens({ stream: 'stdout', theme: flags.theme });
    const { name } = args;

    if (!isPluginName(name)) {
      this.fail(`"${name}" isn't a plugin name`, {
        hint: 'Use lowercase words joined by hyphens, like `my-notes`.',
      });
    }
    if (findEntry(await loadCatalog(), name)) {
      this.fail(`${name} is already a Chronicle plugin`, {
        hint: 'Choose another name, or add your copy with `chronicle plugins add ./its-folder`.',
      });
    }
    const dir = path.resolve(flags.dir ?? name);
    if (existsSync(dir)) {
      if (!(await fs.stat(dir)).isDirectory()) {
        this.fail(`${dir} already exists and isn't a folder.`);
      }
      if ((await fs.readdir(dir)).length > 0) {
        this.fail(`${dir} already exists and isn't empty.`);
      }
    }

    const kind = (flags.from ?? (await this.askKind(flags.theme))) as Kind;

    for (const [file, contents] of Object.entries(
      scaffold({ name, kind, version: this.config.version })
    )) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), contents);
    }
    try {
      await addLocalPlugin(this.config.configDir, dir);
    } catch (error) {
      this.failFrom(error);
    }

    this.log(`${t.success('Created and added')} ${t.strong(name)} ${t.muted(dir)}`);
    this.log('');
    this.log(
      `${t.muted('Next: follow')} ${path.join(dir, 'AGENTS.md')}${t.muted(
        ', or point a coding agent at it.'
      )}`
    );
  }

  private async askKind(theme: string | undefined): Promise<string> {
    if (!canAsk()) {
      this.fail(`Say how the data reaches you with --from (${Object.keys(KINDS).join(', ')}).`);
    }
    const { select } = await import('../../output/prompts.js');
    const { value, cancelled } = await select(
      'How does the data reach you?',
      Object.entries(KINDS).map(([value, { label }]) => ({ label, value })),
      { theme }
    );
    if (cancelled) this.exit(130);
    return value;
  }
}
