import { count, type Intro, type Step } from '../output/index.js';

const STEPS: Step[] = [
  { name: 'gather', description: 'pick what to bring in' },
  { name: 'prepare', description: 'sign in and ask for exports, now or later' },
  { name: 'import', description: 'bring in the last year of each' },
];

/** What setup does, said beside the logo on a run that starts. */
export const INTRO: Intro = {
  title: 'Set up Chronicle',
  steps: STEPS,
  note: 'Nothing is imported until you pick it.',
};

/** Where a pick stands, on a run that carries on: imported, waiting on an export, or left to do. */
export interface Standing {
  source: string;
  /** How it's named: its source, and which of its picks when it has more than one. */
  name: string;
  state: 'done' | 'waiting' | 'left';
  text: string;
}

/** The most picks a resumed run lists one by one. Past it, those imported are counted on one line. */
const LISTED = 8;

/**
 * What setup says on a run that carries on from the last, before any of
 * it is through: that it's resuming, and where each pick stands, in place
 * of the steps: those imported, then those waiting, then those left.
 */
export function resumed(picks: Standing[]): Intro {
  const done = picks.filter(pick => pick.state === 'done');
  const rest = [
    ...picks.filter(pick => pick.state === 'waiting'),
    ...picks.filter(pick => pick.state === 'left'),
  ];
  const imported =
    picks.length > LISTED && done.length > 1
      ? [{ name: `${count(done.length)} sources`, state: 'done' as const, text: 'imported' }]
      : done;
  return {
    title: 'Resuming setup',
    steps: [...imported, ...rest].map(({ name, state, text }) => ({
      name,
      description: text,
      mark: state,
    })),
  };
}
