import { Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import { FlagManager } from './FlagManager.js';
import type { VerbHelp } from './sourceHelp.js';

const {
  since,
  until,
  type,
  'list-types': listTypes,
} = FlagManager.getBaseFlags(BaseCommand.baseFlags);

/** What `survey` takes beside a source's own options: the run's filters, and how to print. */
export const SURVEY_FLAGS = {
  since: {
    ...since,
    helpGroup: 'RECORD',
    summary: 'Count records from this date on, or this long ago, like 30d',
  },
  until: { ...until, helpGroup: 'RECORD', summary: 'Count records up to this date' },
  type: { ...type, helpGroup: 'RECORD', summary: 'Record types to count, comma-separated' },
  format: Flags.string({
    summary: 'How to print what was counted',
    options: ['table', 'json', 'csv'],
    default: 'table',
    helpGroup: 'OUTPUT',
  }),
};

/** A source's help under `survey`: its filters and format, and every kind when none are named. */
export const SURVEY_HELP: VerbHelp = {
  common: ['type', 'list-types', 'since', 'until', 'format'],
  flags: { ...SURVEY_FLAGS, 'list-types': listTypes },
  defaults: 'all',
};
