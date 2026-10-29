import type { SetupStep } from '../plugins/catalog.js';

/** Where the browser comes back to after a sign-in, as `chronicle auth login` listens by default. */
export const SIGN_IN_PORT = 7463;
const CALLBACK = `http://127.0.0.1:${SIGN_IN_PORT}/callback`;

/** A source, and how it's read: the strategy a step gets ready. */
export interface Way {
  source: string;
  strategy: string;
}

/**
 * Something a person does before some sources can be extracted, which setup
 * offers once the rest are under way: a sign-in, an export to ask for, or
 * Full Disk Access.
 */
export interface Todo {
  /** What it's known by between runs: `sign-in:google`, `setup:goodreads:csv`, `full-disk-access`. */
  key: string;
  kind: 'sign-in' | 'export' | 'access';
  /** For an export asked for on an earlier run: when. Its steps are done; it waits for its path. */
  requested?: string;
  /** Its name, like `google`. */
  name: string;
  /** What it is, in a word or two: `sign in`, `export`. */
  what: string;
  /** What it gets ready. */
  ways: Way[];
  steps: SetupStep[];
  /** How much it asks of the person: the least comes first. */
  cost: number;
}

/** What a source needs before it can be extracted, as setup works it out. */
export type Need =
  | (Way & { need: 'sign-in'; provider: string; steps?: SetupStep[]; client: boolean })
  | (Way & { need: 'export'; steps: SetupStep[]; requested?: string })
  | (Way & { need: 'full-disk-access' });

/** The steps of an export whose plugin gives none: ask for it, and wait. */
export const exportSteps = (source: string): SetupStep[] => [
  { do: `request your data from ${source}` },
  { wait: 'until it comes' },
];

/** The steps of a sign-in for a provider without a client of the person's own yet, and no steps of its own. */
const appSteps = (provider: string): SetupStep[] => [
  { do: `make an app on ${provider}'s developer site, with redirect uri ${CALLBACK}` },
  { ask: 'client-id' },
  { ask: 'client-secret' },
  { 'sign-in': provider },
];

/**
 * The todos for what's needed: one sign-in for each provider, however many
 * sources it opens; one for each export; and one for Full Disk Access. A provider
 * whose client is kept, or that sets one up itself, signs in alone; one
 * without is walked through making an app.
 */
export function todosFor(needs: Need[]): Todo[] {
  const todos = new Map<string, Todo>();
  for (const need of needs) {
    const way = { source: need.source, strategy: need.strategy };
    if (need.need === 'sign-in') {
      const key = `sign-in:${need.provider}`;
      const known = todos.get(key);
      if (known) {
        known.ways.push(way);
        continue;
      }
      const steps = need.client
        ? [{ 'sign-in': need.provider }]
        : (need.steps ?? appSteps(need.provider));
      todos.set(key, {
        key,
        kind: 'sign-in',
        name: need.provider,
        what: 'sign in',
        ways: [way],
        steps,
        cost: need.client ? 1 : 2,
      });
    } else if (need.need === 'export') {
      const key = `setup:${need.source}:${need.strategy}`;
      const later = need.steps.some(step => 'wait' in step && step.via === 'email');
      const { requested } = need;
      todos.set(key, {
        key,
        kind: 'export',
        ...(requested && { requested }),
        name: need.source,
        what: requested
          ? `requested ${requested.slice(0, 10)}`
          : later
            ? 'request export'
            : 'export',
        ways: [way],
        steps: requested ? [] : need.steps,
        cost: requested ? 3 : later ? 4 : 3,
      });
    } else {
      const key = 'full-disk-access';
      const known = todos.get(key);
      if (known) {
        if (!known.ways.some(w => w.source === need.source)) known.ways.push(way);
        continue;
      }
      todos.set(key, {
        key,
        kind: 'access',
        name: 'full disk access',
        what: '',
        ways: [way],
        steps: [],
        cost: 9,
      });
    }
  }
  return [...todos.values()];
}

/**
 * The todos in the order they're offered: those never put off, the least
 * work first; then those put off, the longest ago first.
 */
export function order(todos: Todo[], later: Record<string, string> = {}): Todo[] {
  return [...todos].sort((a, b) => {
    const [x, y] = [later[a.key], later[b.key]];
    if (!x !== !y) return x ? 1 : -1;
    if (x && y && x !== y) return x < y ? -1 : 1;
    return a.cost - b.cost;
  });
}

/** A page's address, as a person reads it: no scheme, no `www.`, no trailing slash. */
export const address = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/** A step, as the todo lists it. */
export function stepText(step: SetupStep): string {
  if ('open' in step) return `open ${address(step.open)}`;
  if ('do' in step) return step.do;
  if ('ask' in step) return `paste the ${step.ask.replace('-', ' ')}`;
  if ('sign-in' in step) return `sign in to ${step['sign-in']}`;
  return `wait ${step.wait}${step.via ? ` for the ${step.via}` : ''}`;
}

/** What a way in gets, in a few words: its plugin's summary, or its record types. */
export function gets(strategy: { summary?: string; recordTypes: string[] }): string {
  return strategy.summary ?? strategy.recordTypes.map(kind => kind.replaceAll('-', ' ')).join(', ');
}

/** What the todo's button says: what pressing it does first. */
export function action(todo: Todo): string {
  if (todo.kind === 'access') return 'open settings';
  if (todo.requested) return 'give path';
  const first = todo.steps[0];
  if (first && 'open' in first) return 'open';
  if (first && 'sign-in' in first) return 'sign in';
  return 'start';
}
