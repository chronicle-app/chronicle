import { Errors, type Hook, type Interfaces } from '@oclif/core';
import { EXIT_CODES, createLogger } from '@chronicle.app/logging';
import { outputFlagsIn, sinkFor } from '../output/index.js';
import { closest } from '../utils/closest.js';

/**
 * Report a command that doesn't exist and exit, said like every other error.
 * A command given as one quoted argument (`"auth list --help"`) gets the same
 * command back with its words apart, flags and all, since that one runs.
 */
export function unknownCommand(
  config: Pick<Interfaces.Config, 'commands'>,
  id: string,
  argv: string[] = []
): never {
  const logger = createLogger({ scope: 'cli', sink: sinkFor(outputFlagsIn(argv)) });
  const typed = id.replaceAll(':', ' ');
  const commands = config.commands
    .filter(command => !command.hidden)
    .map(command => command.id.replaceAll(':', ' '));
  const words = typed.trim().split(/\s+/);
  // oclif's ids never hold a space, so one means the words came as one argument.
  const joined =
    id.includes(' ') && words.some((_, i) => commands.includes(words.slice(0, i + 1).join(' ')));
  const guess = closest(typed, commands);
  logger.emit({
    level: 'error',
    kind: 'error',
    message: `Unknown command "${typed}"`,
    error: { code: 'unknown-command', exitCode: EXIT_CODES.usage },
    hint: {
      action: joined
        ? `Pass each word as its own argument: \`chronicle ${[...words, ...argv].join(' ')}\``
        : guess
          ? `Did you mean \`chronicle ${guess}\`?`
          : 'Run `chronicle --help` to see the commands.',
    },
  });
  logger.flush();
  throw new Errors.ExitError(EXIT_CODES.usage);
}

/** oclif raises an unknown command before any command runs, so no command's `catch` sees it. */
const hook: Hook<'command_not_found'> = async function ({ id, argv }) {
  // `help` among a command's or topic's words asks for its help, as `extract shell help` does.
  const words = id.split(':');
  const subject = words.filter(word => word !== 'help');
  if (subject.length > 0 && subject.length < words.length) {
    const asked = subject.join(':');
    if (this.config.findCommand(asked) || this.config.findTopic(asked)) {
      await this.config.runCommand('help', [...subject, ...(argv ?? [])]);
      return;
    }
  }
  unknownCommand(this.config, id, argv ?? []);
};

export default hook;
