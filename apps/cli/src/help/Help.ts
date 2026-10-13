import { Help, type Command, type Interfaces } from '@oclif/core';
import { getHelpFlagAdditions, standardizeIDFromArgv } from '@oclif/core/help';
import { unknownCommand } from '../hooks/commandNotFound.js';
import { outputFlagsIn, paragraph, tokens, type Tokens } from '../output/index.js';
import { renderSourceHelp } from '../utils/sourceHelp.js';
import {
  PLUGIN_SUMMARIES,
  commandHelp,
  helpWidth,
  listedSummary,
  rootHelp,
  topicHelp,
  typed,
  type Entry,
} from './render.js';

// Verb (or its short alias) -> canonical verb for usage text.
const SOURCE_VERBS = new Map<string, string>([
  ['extract', 'extract'],
  ['e', 'extract'],
]);

/**
 * Every help screen, drawn with the output module like the rest of the CLI:
 * the root, topics, commands (the plugins' too), and a source's own help for
 * `chronicle extract <source> --help` (and `e`, and `chronicle help
 * extract <source>`). oclif still finds what to show; this draws it.
 *
 * oclif renders help BEFORE a command's init() runs (main.run → helpAddition →
 * showHelp), so the dispatcher can't intercept --help itself. Hooking the help
 * layer here also means it works while per-plugin `extract:<source>` commands
 * still exist (it overrides their help too).
 */
export default class ChronicleHelp extends Help {
  private t: Tokens = tokens({ stream: 'stdout' });
  private readonly width = helpWidth();

  async showHelp(argv: string[]): Promise<void> {
    const { theme } = outputFlagsIn(argv);
    this.t = tokens({ stream: 'stdout', theme });
    let positionals = argv.filter(a => !a.startsWith('-'));
    if (positionals[0] === 'help') positionals = positionals.slice(1);

    const verb = positionals[0] ? SOURCE_VERBS.get(positionals[0]) : undefined;
    const source = positionals[1];

    if (verb && source) {
      const { PluginScanner } = await import('../plugins/PluginScanner.js');
      const candidates = (await PluginScanner.scanAllPlugins()).get(source) ?? [];
      if (candidates.length > 0) {
        this.log(renderSourceHelp(source, candidates, { verb, theme }));
        return;
      }
      const { listSources } = await import('../plugins/catalog.js');
      const listing = (await listSources()).find(s => s.source === source && !s.installed);
      if (listing) {
        const install = `chronicle plugins install ${listing.plugin}`;
        this.log(
          paragraph(
            `${source} isn't installed. Run \`${install}\` to install it.`,
            this.t,
            this.width
          ).join('\n')
        );
        return;
      }
    }

    // `chronicle help nope`: the same error as running it. The subject is
    // found the way oclif finds it: the first word, unless a flag comes first.
    const helpFlags = getHelpFlagAdditions(this.config);
    const words = standardizeIDFromArgv(
      argv.filter(arg => !helpFlags.includes(arg)),
      this.config
    );
    const at = words.findIndex(arg => arg !== 'help');
    const subject = at >= 0 && !words[at].startsWith('-') ? words[at] : undefined;
    if (subject && !this.config.findCommand(subject) && !this.config.findTopic(subject)) {
      // The flags after it are kept, with --help, so a command it suggests still shows help.
      unknownCommand(this.config, subject, ['--help', ...words.slice(at + 1)]);
    }
    await super.showHelp(argv);
  }

  async showRootHelp(): Promise<void> {
    this.log(this.formatRoot());
  }

  async showTopicHelp(topic: Interfaces.Topic): Promise<void> {
    this.log(this.formatTopic(topic));
  }

  async showCommandHelp(command: Command.Loadable): Promise<void> {
    this.log(this.formatCommand(command));
  }

  formatRoot(): string {
    // A name that's both a topic and a command (`sources`) is listed once, by
    // its command; an alias (`e`) isn't listed at all. `chronicle help
    // --nested-commands` lists every command instead of the top level.
    const nested = Boolean(this.opts.all);
    const own = new Map<string, Entry>();
    for (const topic of nested ? [] : this.sortedTopics.filter(t => !t.name.includes(':'))) {
      own.set(topic.name, { name: topic.name, summary: topic.description });
    }
    const plugins: Entry[] = [];
    for (const command of this.sortedCommands) {
      if (command.hidden || command.aliases.includes(command.id)) continue;
      if (!nested && command.id.includes(':')) continue;
      const entry = { name: typed(command.id), summary: listedSummary(command) };
      if (command.pluginName === this.config.name) own.set(command.id, entry);
      else plugins.push(entry);
    }
    return rootHelp(
      {
        version: this.config.version,
        summary: this.config.pjson.description,
        commands: [...[...own.values()].sort((a, b) => a.name.localeCompare(b.name)), ...plugins],
      },
      this.t,
      this.width
    );
  }

  formatTopic(topic: Interfaces.Topic): string {
    return topicHelp(
      { name: topic.name, description: topic.description, commands: this.childrenOf(topic.name) },
      this.t,
      this.width
    );
  }

  formatCommand(command: Command.Cached): string {
    return commandHelp(
      command,
      { commands: this.childrenOf(command.id), summary: PLUGIN_SUMMARIES[command.id] },
      this.t,
      this.width
    );
  }

  /** The topics and commands one level under `name`. */
  private childrenOf(name: string): Entry[] {
    const depth = name.split(':').length + 1;
    const under = (id: string) => id.startsWith(`${name}:`) && id.split(':').length === depth;
    const topics = this.sortedTopics
      .filter(topic => under(topic.name))
      .map(topic => ({ name: typed(topic.name), summary: topic.description }));
    const commands = this.sortedCommands
      .filter(command => under(command.id) && !command.aliases.includes(command.id))
      .filter(command => !topics.some(topic => topic.name === typed(command.id)))
      .map(command => ({ name: typed(command.id), summary: listedSummary(command) }));
    return [...topics, ...commands].sort((a, b) => a.name.localeCompare(b.name));
  }
}
