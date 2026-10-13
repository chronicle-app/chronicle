import { Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import { listedSummary, typed } from '../help/render.js';
import { stdoutWidth, table, tokens } from '../output/index.js';

export default class Commands extends BaseCommand<typeof Commands> {
  static override description = 'List every command';

  static override examples = ['chronicle commands', 'chronicle commands --format json'];

  static override flags = {
    ...BaseCommand.baseFlags,
    format: Flags.string({
      summary: 'How to print the list',
      options: ['table', 'json'],
      default: 'table',
      helpGroup: 'OUTPUT',
    }),
  };

  async run(): Promise<void> {
    // Each command once, as it's typed and described in help: no aliases (`e`), nothing hidden.
    const commands = this.config.commands
      .filter(command => !command.hidden && !command.aliases.includes(command.id))
      .map(command => ({ command: typed(command.id), summary: listedSummary(command) }))
      .sort((a, b) => a.command.localeCompare(b.command));

    if (this.flags.format === 'json') {
      this.log(JSON.stringify(commands, null, 2));
      return;
    }
    const t = tokens({ stream: 'stdout', theme: this.flags.theme });
    const { lines } = table(
      {
        headings: ['command', 'description'],
        cells: commands.map(({ command, summary }) => [command, summary]),
      },
      t,
      stdoutWidth()
    );
    for (const line of lines) this.log(line);
    this.hint('Add `--help` to any command to see its flags.');
  }
}
