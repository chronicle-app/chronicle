import { glyphs, line, type Segment, type Tokens } from '../output/index.js';

/** Setup's steps, in order: pick what to bring in, get it ready, and import it. */
export const STEPS = ['gather', 'prepare', 'import'] as const;

export type StepName = (typeof STEPS)[number];

/**
 * Where a step is: not started; `working`, with a spinner; `asking`, waiting
 * on the person; or `done`.
 */
export type StepState = 'waiting' | 'working' | 'asking' | 'done';

/**
 * Setup's checklist: each step, where it is, and a few words on it, like
 * `23 picked`. Drawn above whatever the step shows, so it's always plain
 * which step this is and what's left.
 *
 *   ✓ gather    23 picked
 *   ● prepare   1 of 3
 *   · import
 */
export class Steps {
  private readonly states = new Map<StepName, { state: StepState; note: string }>(
    STEPS.map(name => [name, { state: 'waiting', note: '' }])
  );

  /** Set a step's state, and its note, or keep the note it has. */
  set(name: StepName, state: StepState, note?: string): void {
    const before = this.states.get(name)!;
    this.states.set(name, { state, note: note ?? before.note });
  }

  /** Change a step's note alone. */
  note(name: StepName, note: string): void {
    this.states.get(name)!.note = note;
  }

  state(name: StepName): StepState {
    return this.states.get(name)!.state;
  }

  /** Whether a step is working, so its spinner turns. */
  working(): boolean {
    return [...this.states.values()].some(({ state }) => state === 'working');
  }

  lines(t: Tokens, width: number, frame = 0): string[] {
    const names = Math.max(...STEPS.map(name => name.length));
    return STEPS.map(name => {
      const { state, note } = this.states.get(name)!;
      const mark: Segment =
        state === 'done'
          ? [glyphs.success, t.success]
          : state === 'working'
            ? [glyphs.spinner[frame % glyphs.spinner.length], t.accent]
            : state === 'asking'
              ? [glyphs.current, t.accent]
              : [glyphs.bullet, t.muted];
      // Padded only to line up a note after it.
      const text = note ? name.padEnd(names) : name;
      const label: Segment =
        state === 'waiting' ? [text, t.muted] : state === 'done' ? [text] : [text, t.strong];
      return line([[' '], mark, [' '], label, [note ? `   ${note}` : '', t.muted]], width);
    });
  }
}
