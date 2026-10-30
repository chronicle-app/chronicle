import { Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import { FlagManager } from './FlagManager.js';
import type { VerbHelp } from './sourceHelp.js';

const base = FlagManager.getBaseFlags(BaseCommand.baseFlags);

/** Where an import's records go, and how many fold at once. */
export const STORE_FLAGS = {
  db: Flags.string({
    helpGroup: 'LOADING',
    helpValue: '<path>',
    summary: 'The store to import into. The default is in your Chronicle data folder.',
  }),
  'fold-batch': Flags.integer({
    env: 'CHRONICLE_FOLD_BATCH',
    helpGroup: 'LOADING',
    helpValue: '<n>',
    min: 1,
    summary: 'Records folded into the store per transaction',
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
