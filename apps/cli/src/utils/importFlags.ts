import { Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import { FlagManager } from './FlagManager.js';
import type { VerbHelp } from './sourceHelp.js';

const base = FlagManager.getBaseFlags(BaseCommand.baseFlags);

/** Where an import's records go. */
export const STORE_FLAGS = {
  db: Flags.string({
    helpGroup: 'LOADING',
    helpValue: '<path>',
    summary: 'The store to import into. The default is in your Chronicle data folder.',
  }),
};

/** An import reads the whole source unless told otherwise. */
export const IMPORT_LIMIT = {
  ...base.limit,
  default: 0,
  summary: 'The most records to import. The default is all of them.',
};

/** A source's help under `import`: the run's scope, and the store. */
export const IMPORT_HELP: VerbHelp = {
  common: ['type', 'list-types', 'limit', 'since', 'until', 'db'],
  flags: { ...base, limit: IMPORT_LIMIT, ...STORE_FLAGS },
};
