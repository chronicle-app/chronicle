import type { Intro } from '../output/index.js';

/** What setup does, said on a first run beside the logo. */
export const INTRO: Intro = {
  title: 'Bring in your history',
  steps: [
    { name: 'scan', description: 'find apps that keep your history' },
    { name: 'look', description: 'check ~/Downloads and more for exports' },
    { name: 'pick', description: 'choose sources, sign in if needed' },
    { name: 'extract', description: 'write each pick to its own file' },
  ],
  note: 'Nothing is extracted until you pick it.',
};
