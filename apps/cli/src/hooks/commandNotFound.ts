import { Errors, type Hook } from '@oclif/core';
import { EXIT_CODES, createLogger } from '@chronicle.app/logging';
import { outputFlagsIn, sinkFor } from '../output/index.js';
import { closest } from '../utils/closest.js';

/**
 * A command that doesn't exist, said like every other error: oclif raises it
 * before any command runs, so no command's `catch` sees it.
 */
const hook: Hook<'command_not_found'> = async function ({ id, argv }) {
  const logger = createLogger({ scope: 'cli', sink: sinkFor(outputFlagsIn(argv ?? [])) });
  const typed = id.replaceAll(':', ' ');
  const commands = this.config.commands
    .filter(command => !command.hidden)
    .map(command => command.id.replaceAll(':', ' '));
  const guess = closest(typed, commands);
  logger.emit({
    level: 'error',
    kind: 'error',
    message: `No command named "${typed}"`,
    error: { code: 'unknown-command', exitCode: EXIT_CODES.usage },
    hint: {
      action: guess
        ? `Did you mean: \`chronicle ${guess}\``
        : 'See the commands: `chronicle --help`',
    },
  });
  logger.flush();
  throw new Errors.ExitError(EXIT_CODES.usage);
};

export default hook;
