import type { Intro, Step } from '../output/index.js';

const STEPS: Step[] = [
  { name: 'scan', description: 'find what this mac holds' },
  { name: 'add', description: 'pick services to bring in' },
  { name: 'extract', description: 'write each to its own file' },
  { name: 'todo', description: 'sign in and request exports, now or later' },
];

/** What setup does, said on a first run beside the logo. */
export const INTRO: Intro = {
  title: 'Bring in your history',
  steps: STEPS,
  note: 'Nothing is extracted until you pick it.',
};

/**
 * What setup does, said on a later run: the same steps, under a title that
 * says it's carrying on, and a note on where it left off.
 */
export function resumed({
  picked,
  extracted,
  left,
}: {
  picked: number;
  extracted: number;
  left: string[];
}): Intro {
  const picks = `${picked === 1 ? 'pick' : 'picks'} extracted.`;
  const done = extracted === picked ? `${picked} ${picks}` : `${extracted} of ${picked} ${picks}`;
  const todo = left.length > 0 ? ` Left to do: ${left.join(', ')}.` : '';
  return { title: 'Resuming setup', steps: STEPS, note: `${done}${todo} Your picks are kept.` };
}
