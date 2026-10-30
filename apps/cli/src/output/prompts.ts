import {
  AbortPromptError,
  ExitPromptError,
  createPrompt,
  isEnterKey,
  isSpaceKey,
  useEffect,
  useKeypress,
  useRef,
  useState,
  type KeypressEvent,
} from '@inquirer/core';
import { emitKeypressEvents } from 'node:readline';
import { EXIT_CODES } from '@chronicle.app/logging';
import { truncate } from './format.js';
import { glyphs } from './glyphs.js';
import { visibleWidth } from './logo/text.js';
import { canAsk } from './sinks.js';
import { tokens, type Tokens } from './tokens.js';

/**
 * Questions asked at a terminal: `confirm`, `proceed`, `select`,
 * `multiSelect`, and `input`, and `awaitEnter` and `awaitKey` for one drawn elsewhere. Each draws on stderr, so stdout stays for records, and reads keys
 * only while it's asking. Esc, Ctrl+C, or Ctrl+D cancels. Callers check
 * `canAsk()` first and, without a terminal, say which flag to pass instead.
 * `select`, `multiSelect`, and `input` can draw lines above themselves, like
 * a run's progress, and be withdrawn.
 */

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  /**
   * In a multiSelect, a step rather than a choice, like looking somewhere
   * else: Enter on it answers with what's selected and it. It can't be selected.
   */
  action?: boolean;
  /**
   * In a multiSelect, a choice that stands alone, like none of the others:
   * selecting it clears the rest, and selecting another clears it. It's set
   * apart from those above it by a rule.
   */
  alone?: boolean;
  /**
   * In a multiSelect, the name of a group this option starts, said above it
   * after a blank line, and any lines after it, like what's in the group.
   * The group runs to the next option with a heading.
   */
  heading?: string;
}

/** Hides the terminal's cursor while a list is up; the prompt shows it again when done. */
const HIDE_CURSOR = '\u001B[?25l';

/** Where a question is asked: stdin and stderr unless a test gives its own streams. */
export interface Terminal {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/** What `select`, `multiSelect`, and `input` take besides their own. */
export interface Around {
  theme?: string;
  terminal?: Terminal;
  /** Lines drawn above the question, each time it's drawn: what's going on around it. */
  header?: () => string[];
  /** For a header or options that change while asked: called with what draws them again. */
  subscribe?: (redraw: () => void) => () => void;
  /** Leave nothing once answered, rather than the answer. */
  clear?: boolean;
  /** Withdraws the question, which then answers as cancelled. */
  signal?: AbortSignal;
  /** What Esc says it does: `cancel` unless given, like `quit` for a question that ends a run. */
  esc?: string;
}

/**
 * In a multiSelect, a key that does something else, like looking in a
 * folder: pressing it answers with what's selected and `value`.
 */
export interface KeyAction {
  key: string;
  label: string;
  value: string;
}

const keysLine = (t: Tokens, keys: string[]) => t.muted(keys.join(` ${glyphs.bullet} `));
const isEscape = (key: KeypressEvent) => key.name === 'escape';
const isUp = (key: KeypressEvent) => key.name === 'up' || (key.name === 'k' && !key.ctrl);
const isDown = (key: KeypressEvent) => key.name === 'down' || (key.name === 'j' && !key.ctrl);

/**
 * Ctrl+D on an empty line closes readline, and inquirer then leaves the
 * question unanswered, so the process would exit mid-await. Answer it as a
 * cancel instead. Closing clears this effect before the listener runs, but a
 * listener removed during an emit still runs.
 */
function useCancelOnClose(cancel: () => void) {
  useEffect(rl => {
    rl.on('close', cancel);
    return () => rl.removeListener('close', cancel);
  }, []);
}

/**
 * Run a prompt on stderr. It clears itself when done, and an answer leaves
 * `answered`'s lines in its place; a cancel, or going back, leaves nothing.
 * Ctrl+C is a cancel, not an error.
 */
async function ask<Value extends { cancelled: boolean }>(
  terminal: Terminal = {},
  run: (context: {
    input?: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
    clearPromptOnDone: boolean;
    signal?: AbortSignal;
  }) => Promise<Value>,
  cancelled: Value,
  answered?: (value: Value) => string,
  signal?: AbortSignal
): Promise<Value> {
  const output = terminal.output ?? process.stderr;
  // A caller that forgot to check would wait on a pipe for keys that never come.
  if (!terminal.input && !canAsk()) {
    throw Object.assign(new Error("Can't ask a question without a terminal"), {
      code: 'no-terminal',
      exitCode: EXIT_CODES.usage,
    });
  }
  let value: Value;
  try {
    value = await run({ input: terminal.input, output, clearPromptOnDone: true, signal });
  } catch (error) {
    if (error instanceof ExitPromptError || error instanceof AbortPromptError) return cancelled;
    throw error;
  }
  // Going back leaves nothing, as a cancel does.
  const { back } = value as { back?: boolean };
  if (answered && !value.cancelled && !back) output.write(`${answered(value)}\n`);
  return value;
}

/** Highlighted row first, then the option and what it is. */
function optionRow(t: Tokens, option: SelectOption, here: boolean, mark = '', columns?: number) {
  const row = `${here ? glyphs.pointer : ' '} ${mark}${option.label}`;
  // Within `columns`, when given: what it is is cut short, rather than wrapping.
  const room = columns ? columns - 1 - visibleWidth(row) - 1 : Number.POSITIVE_INFINITY;
  const description = option.description && room > 1 ? truncate(option.description, room) : '';
  return (here ? t.accent(row) : row) + (description ? t.muted(` ${description}`) : '');
}

/** A header's lines, apart from the question under them. */
const above = (header?: () => string[]) => {
  const lines = header?.() ?? [];
  return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
};

/** Draw the question again whenever `subscribe` says to. */
function useRedraws(subscribe?: (redraw: () => void) => () => void) {
  const [, setDrawn] = useState(0);
  useEffect(() => subscribe?.(() => setDrawn(n => n + 1)), []);
}

export interface ConfirmResult {
  confirmed: boolean;
  cancelled: boolean;
}

const confirmPrompt = createPrompt<
  ConfirmResult,
  { message: string; defaultValue: boolean; t: Tokens }
>(({ message, defaultValue, t }, done) => {
  const [yes, setYes] = useState(defaultValue);
  const [finished, setFinished] = useState(false);
  const finish = (result: ConfirmResult) => {
    setFinished(true);
    done(result);
  };
  useCancelOnClose(() => done({ confirmed: false, cancelled: true }));

  useKeypress((key, rl) => {
    if (finished) return;
    // Readline keeps each key typed as a line; this one has none.
    rl.clearLine(0);
    if (isEnterKey(key)) return finish({ confirmed: yes, cancelled: false });
    if (isEscape(key)) return finish({ confirmed: false, cancelled: true });
    switch (key.name) {
      case 'y':
        setYes(true);
        break;
      case 'n':
        setYes(false);
        break;
      case 'left':
      case 'right':
        setYes(!yes);
        break;
    }
  });

  if (finished) return '';
  const choice = yes
    ? `${t.strong('Yes')}${t.muted(' / No')}`
    : `${t.muted('Yes / ')}${t.strong('No')}`;
  return [
    `${t.strong(message)}\n\n${t.accent(glyphs.pointer)} ${choice}${HIDE_CURSOR}`,
    `\n${keysLine(t, ['y/n choose', '←/→ toggle', 'enter confirm', 'esc cancel'])}`,
  ];
});

/** Ask yes or no. */
export function confirm(
  message: string,
  {
    defaultValue = false,
    theme,
    terminal,
  }: { defaultValue?: boolean; theme?: string; terminal?: Terminal } = {}
): Promise<ConfirmResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context => confirmPrompt({ message, defaultValue, t }, context),
    { confirmed: false, cancelled: true },
    ({ confirmed }) => `${t.strong(message)} ${t.muted(confirmed ? 'Yes' : 'No')}`
  );
}

export interface ProceedResult {
  cancelled: boolean;
  /** The key action's key, when one was pressed instead of Enter. */
  key?: string;
}

const proceedPrompt = createPrompt<
  ProceedResult,
  { message: string; enter: string; actions: { key: string; label: string }[]; t: Tokens }
>(({ message, enter, actions, t }, done) => {
  const [finished, setFinished] = useState(false);
  const finish = (result: ProceedResult) => {
    setFinished(true);
    done(result);
  };
  useCancelOnClose(() => done({ cancelled: true }));

  useKeypress((key, rl) => {
    if (finished) return;
    rl.clearLine(0);
    if (isEnterKey(key)) finish({ cancelled: false });
    else if (isEscape(key)) finish({ cancelled: true });
    else if (actions.some(action => action.key === key.name && !key.ctrl)) {
      finish({ cancelled: false, key: key.name });
    }
  });

  if (finished) return '';
  const keys = [`enter ${enter}`, ...actions.map(a => `${a.key} ${a.label}`), 'esc cancel'];
  return [
    // Apart from what it follows, which says what Enter goes on to.
    `\n${t.accent(glyphs.pointer)} ${t.strong(message)}${HIDE_CURSOR}`,
    `\n${keysLine(t, keys)}`,
  ];
});

/**
 * Wait for Enter, saying what it does: `Press Enter to start`, and `enter`
 * in the keys, `continue` unless given. `actions` are other keys that
 * answer, by `key`. The question clears once answered.
 */
export function proceed(
  message: string,
  {
    enter = 'continue',
    actions = [],
    theme,
    terminal,
  }: {
    enter?: string;
    actions?: { key: string; label: string }[];
    theme?: string;
    terminal?: Terminal;
  } = {}
): Promise<ProceedResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(terminal, context => proceedPrompt({ message, enter, actions, t }, context), {
    cancelled: true,
  });
}

/**
 * Wait for Enter, drawing nothing, for a question something else draws as
 * it goes on, like the splash's `Press Enter to start`. True for Enter;
 * false for Esc, Ctrl+C, or Ctrl+D, which cancel. Without a terminal it
 * fails, as every question does.
 */
export async function awaitEnter(input: NodeJS.ReadStream = process.stdin): Promise<boolean> {
  return (await awaitKey([], input)) === 'enter';
}

/**
 * Wait for Enter or one of `keys`, drawing nothing, as `awaitEnter` does:
 * `enter`, or the key's name. Undefined for Esc, Ctrl+C, or Ctrl+D, which
 * cancel.
 */
export function awaitKey(
  keys: string[],
  input: NodeJS.ReadStream = process.stdin
): Promise<string | undefined> {
  if (!input.isTTY) {
    throw Object.assign(new Error("Can't ask a question without a terminal"), {
      code: 'no-terminal',
      exitCode: EXIT_CODES.usage,
    });
  }
  return new Promise(resolve => {
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    const done = (answer?: string) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      resolve(answer);
    };
    const onKey = (_: string, key: KeypressEvent | undefined) => {
      if (!key) return;
      if (isEnterKey(key)) done('enter');
      else if (isEscape(key) || (key.ctrl && (key.name === 'c' || key.name === 'd'))) {
        done();
      } else if (!key.ctrl && key.name && keys.includes(key.name)) done(key.name);
    };
    input.on('keypress', onKey);
  });
}

export interface SelectResult {
  value: string;
  cancelled: boolean;
}

const selectPrompt = createPrompt<
  SelectResult,
  {
    message: string;
    options: SelectOption[];
    defaultValue?: string;
    inline: boolean;
    body: string[];
    detail?: (value: string) => string[];
    esc: string;
    header?: () => string[];
    subscribe?: (redraw: () => void) => () => void;
    t: Tokens;
  }
>((props, done) => {
  const { message, options, defaultValue, inline, body, detail, esc, header, subscribe, t } = props;
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      options.findIndex(option => option.value === defaultValue)
    )
  );
  const [finished, setFinished] = useState(false);
  const finish = (result: SelectResult) => {
    setFinished(true);
    done(result);
  };
  useCancelOnClose(() => done({ value: '', cancelled: true }));
  useRedraws(subscribe);

  useKeypress((key, rl) => {
    if (finished) return;
    rl.clearLine(0);
    const back = isUp(key) || (inline && key.name === 'left');
    const on = isDown(key) || (inline && key.name === 'right');
    if (back) setCursor(cursor > 0 ? cursor - 1 : options.length - 1);
    else if (on) setCursor(cursor < options.length - 1 ? cursor + 1 : 0);
    else if (isEnterKey(key)) finish({ value: options[cursor].value, cancelled: false });
    else if (isEscape(key)) finish({ value: '', cancelled: true });
  });

  if (finished) return '';
  // Inline, the options sit side by side, like buttons.
  const rows = inline
    ? options
        .map((option, i) =>
          i === cursor ? t.accent(`${glyphs.pointer} ${option.label}`) : `  ${option.label}`
        )
        .join('   ')
    : options.map((option, i) => optionRow(t, option, i === cursor)).join('\n');
  const said = body.length > 0 ? `\n${body.join('\n')}` : '';
  // What the highlighted option involves, under them all.
  const more = detail ? detail(options[cursor].value) : [];
  const under = more.length > 0 ? `\n\n${more.join('\n')}` : '';
  return [
    `${above(header)}${t.strong(message)}${said}\n\n${rows}${under}${HIDE_CURSOR}`,
    `\n${keysLine(t, [inline ? '←/→ move' : '↑/↓ move', 'enter select', `esc ${esc}`])}`,
  ];
});

/**
 * Ask for one of `options`, listed, or `inline` side by side, with any lines
 * of `body` between the question and them, and `detail`'s lines about the
 * highlighted one under them. The question clears once answered.
 */
export function select(
  message: string,
  options: SelectOption[],
  {
    defaultValue,
    inline = false,
    body = [],
    detail,
    header,
    subscribe,
    signal,
    esc = 'cancel',
    theme,
    terminal,
  }: {
    defaultValue?: string;
    inline?: boolean;
    body?: string[];
    detail?: (value: string) => string[];
  } & Around = {}
): Promise<SelectResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context =>
      selectPrompt(
        { message, options, defaultValue, inline, body, detail, esc, header, subscribe, t },
        context
      ),
    { value: '', cancelled: true },
    undefined,
    signal
  );
}

export interface MultiSelectResult {
  values: string[];
  cancelled: boolean;
  /** Answered with ←, to go back to what came before. */
  back?: boolean;
}

/** Where a list is drawn: how many rows and columns it has, when it's a terminal. */
interface Size {
  rows?: number;
  columns?: number;
}

/** How many rows a line takes, wrapped at `columns`. */
const height = (line: string, columns?: number) =>
  columns ? Math.max(1, Math.ceil(visibleWidth(line) / columns)) : 1;

/**
 * The options to show, from `start` up to `end`: those that fit in `room`
 * rows, `heights` giving each one's, with a row each to say how many more
 * are above and below. All of them, when they fit. The cursor's always
 * among them, and the window moves no more than it has to from `top`,
 * where it started last time.
 */
function windowed(
  heights: number[],
  cursor: number,
  room: number,
  top: number
): { start: number; end: number } {
  const rows = (from: number, to: number) => heights.slice(from, to).reduce((n, h) => n + h, 0);
  if (rows(0, heights.length) <= room) return { start: 0, end: heights.length };
  const fits = Math.max(1, room - 2);
  let start = Math.min(top, cursor);
  while (start < cursor && rows(start, cursor + 1) > fits) start++;
  let end = start;
  while (end < heights.length && rows(start, end + 1) <= fits) end++;
  end = Math.max(end, cursor + 1);
  // At the end of the list, what room's left goes to those above.
  while (start > 0 && rows(start - 1, end) <= fits) start--;
  return { start, end };
}

/**
 * The question, any lines under it, and its options, the chosen ones
 * filled. With `fit`, only as many as fit in its `room` rows, around the
 * cursor, saying how many more are above and below; `top` keeps where the
 * window starts, from one drawing to the next.
 */
function choices(
  t: Tokens,
  message: string,
  options: SelectOption[],
  chosen: string[],
  cursor?: number,
  body: string[] = [],
  fit?: { room: number; columns?: number; top: { current: number } }
) {
  const rule = t.muted(`  ${'─'.repeat(Math.max(0, ...options.map(o => o.label.length)) + 2)}`);
  const blocks = options.map((option, i) => {
    const mark = option.action
      ? ' '
      : chosen.includes(option.value)
        ? glyphs.chosen
        : glyphs.unchosen;
    const row = optionRow(t, option, i === cursor, `${mark} `, fit?.columns);
    // A group after the first is apart from the one above it by a blank line.
    const heading = option.heading
      ? [
          ...(i > 0 ? [''] : []),
          ...option.heading.split('\n').map(text => (text ? t.muted(`  ${text}`) : '')),
        ]
      : [];
    return option.alone && i > 0 && !options[i - 1].alone
      ? [...heading, rule, row]
      : [...heading, row];
  });
  let rows = blocks.flat();
  if (fit && cursor !== undefined && options.length > 0) {
    const heights = blocks.map(lines => lines.reduce((n, l) => n + height(l, fit.columns), 0));
    const { start, end } = windowed(heights, cursor, fit.room, fit.top.current);
    fit.top.current = start;
    rows = [
      ...(start > 0 ? [t.muted(`  ↑ ${start} more`)] : []),
      ...blocks.slice(start, end).flat(),
      ...(end < options.length ? [t.muted(`  ↓ ${options.length - end} more`)] : []),
    ];
  }
  const said = body.length > 0 ? `\n${body.join('\n')}` : '';
  return `${t.strong(message)}${said}${rows.length > 0 ? `\n\n${rows.join('\n')}` : ''}`;
}

/** The options in the same group as the one at `cursor`: all of them, without headings. */
function groupOf(options: SelectOption[], cursor: number): SelectOption[] {
  let start = cursor;
  while (start > 0 && !options[start].heading) start--;
  let end = cursor + 1;
  while (end < options.length && !options[end].heading) end++;
  return options.slice(start, end);
}

/**
 * Space toggles the highlighted option, and Enter starts: with nothing
 * toggled it takes just the highlighted one, so a single pick is one key,
 * or with `none`, nothing. Enter on an action takes what's toggled and the
 * action, as does a key action's key. A choice that stands alone clears the
 * others when it's toggled, and they it. `a` toggles all but those, in the
 * highlighted option's group when there are headings, and `d`
 * selects the defaults. With `back`, ← takes what's toggled and goes back;
 * with `onward`, → is Enter. (Shift+Enter can't be told from Enter in most
 * terminals, so it isn't used.)
 */
const multiSelectPrompt = createPrompt<
  MultiSelectResult,
  {
    message: string;
    options: SelectOption[];
    defaults: string[];
    initial: string[];
    none: boolean;
    enter: string;
    skip?: string;
    body: string[];
    actions: KeyAction[];
    back?: string;
    onward: boolean;
    esc: string;
    header?: () => string[];
    subscribe?: (redraw: () => void) => () => void;
    size: () => Size;
    t: Tokens;
  }
>((props, done) => {
  const { message, options, defaults, initial, none, enter, skip, body, actions, esc } = props;
  const { back, onward, header, subscribe, size, t } = props;
  const [cursor, setCursor] = useState(0);
  // Where the window of options starts, on a terminal too short for them all.
  const top = useRef(0);
  const [chosen, setChosen] = useState<string[]>(initial);
  const [finished, setFinished] = useState(false);
  const finish = (result: MultiSelectResult) => {
    setFinished(true);
    done(result);
  };
  useCancelOnClose(() => done({ values: [], cancelled: true }));
  // Options that change while asked are drawn again when they do.
  useRedraws(subscribe);

  useKeypress((key, rl) => {
    if (finished) return;
    rl.clearLine(0);
    if (isUp(key)) setCursor(cursor > 0 ? cursor - 1 : options.length - 1);
    else if (isDown(key)) setCursor(cursor < options.length - 1 ? cursor + 1 : 0);
    else if (isSpaceKey(key)) {
      // With no options, there's nothing to toggle.
      if (!options[cursor]) return;
      const { value, action, alone } = options[cursor];
      if (action) return;
      const apart = new Set(options.filter(option => option.alone).map(option => option.value));
      if (chosen.includes(value)) setChosen(chosen.filter(v => v !== value));
      else if (alone) setChosen([value]);
      else setChosen([...chosen.filter(v => !apart.has(v)), value]);
    } else if (key.name === 'a') {
      // With no options, there's nothing to toggle.
      if (!options[cursor]) return;
      const choosable = groupOf(options, cursor)
        .filter(option => !option.action && !option.alone)
        .map(option => option.value);
      setChosen(
        choosable.every(v => chosen.includes(v))
          ? chosen.filter(v => !choosable.includes(v))
          : [...new Set([...chosen, ...choosable])]
      );
    } else if (key.name === 'd' && defaults.length > 0) {
      setChosen(defaults);
    } else if (actions.some(action => action.key === key.name && !key.ctrl)) {
      const picked = options.map(option => option.value).filter(v => chosen.includes(v));
      const { value } = actions.find(action => action.key === key.name)!;
      finish({ values: [...picked, value], cancelled: false });
    } else if (back && key.name === 'left') {
      const picked = options.map(option => option.value).filter(v => chosen.includes(v));
      finish({ values: picked, cancelled: false, back: true });
    } else if (isEnterKey(key) || (onward && key.name === 'right')) {
      // In the order they're listed, not the order they were toggled.
      const picked = options.map(option => option.value).filter(v => chosen.includes(v));
      const here = options[cursor];
      // With no options, Enter takes none.
      const values = here?.action
        ? [...picked, here.value]
        : picked.length > 0 || none || !here
          ? picked
          : [here.value];
      finish({ values, cancelled: false });
    } else if (isEscape(key)) {
      finish({ values: [], cancelled: true });
    }
  });

  if (finished) return '';
  // With nothing selected, Enter goes on without any: it says so.
  const going = none && skip && chosen.length === 0 && !options[cursor]?.action ? skip : enter;
  const some = options.length > 0;
  const keys = [
    ...(some ? ['space select'] : []),
    ...actions.map(action => `${action.key} ${action.label}`),
    ...(back ? [`← ${back}`] : []),
    `${onward ? 'enter/→' : 'enter'} ${going}`,
    // With headings, `a` takes the highlighted group.
    ...(some ? [options.some(option => option.heading) ? 'a group' : 'a all'] : []),
    ...(defaults.length > 0 ? ['d defaults'] : []),
    `esc ${esc}`,
  ];
  const head = above(header);
  const bottom = keysLine(t, keys);
  // What the options have room for: the terminal's rows, less the lines
  // around them, and one spare, so nothing scrolls off to be drawn again.
  const { rows, columns } = size();
  const around = [
    ...(head ? head.split('\n').slice(0, -1) : []),
    message,
    ...body,
    '',
    '',
    bottom,
    '',
  ];
  const fit = rows
    ? { room: rows - around.reduce((n, l) => n + height(l, columns), 0), columns, top }
    : undefined;
  return [
    `${head}${choices(t, message, options, chosen, cursor, body, fit)}${HIDE_CURSOR}`,
    `\n${bottom}`,
  ];
});

/**
 * Ask for one or more of `options`; `defaults` are what `d` selects, and
 * `initial` are selected to start with. With `none`, Enter with nothing
 * selected picks nothing, rather than the highlighted option. An option's
 * description can change while it's asked, drawn again through `subscribe`.
 * `enter` says what Enter does, `start` unless given, and `skip` what it
 * does with nothing selected. Any lines of `body` go under the question,
 * and `actions` are keys that do something else. For a question that's one
 * of several steps, `back` says where ← goes, answering `back`, and with
 * `onward`, → goes on as Enter does. The picks stay on screen, unless `clear`.
 */
export function multiSelect(
  message: string,
  options: SelectOption[],
  {
    defaults = [],
    initial = [],
    none = false,
    enter = 'start',
    skip,
    body = [],
    actions = [],
    back,
    onward = false,
    header,
    subscribe,
    clear = false,
    signal,
    esc = 'cancel',
    theme,
    terminal,
  }: {
    defaults?: string[];
    initial?: string[];
    none?: boolean;
    enter?: string;
    skip?: string;
    body?: string[];
    actions?: KeyAction[];
    back?: string;
    onward?: boolean;
  } & Around = {}
): Promise<MultiSelectResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context =>
      multiSelectPrompt(
        {
          message,
          options,
          defaults,
          initial,
          none,
          enter,
          skip,
          body,
          actions,
          back,
          onward,
          esc,
          header,
          subscribe,
          // Read each time it's drawn, so a resized terminal gets a window that fits.
          size: () => (terminal?.output ?? process.stderr) as Size,
          t,
        },
        context
      ),
    { values: [], cancelled: true },
    clear ? undefined : ({ values }) => choices(t, message, options, values),
    signal
  );
}

export interface InputResult {
  value: string;
  cancelled: boolean;
  /** Answered with Esc, when Esc goes back to what came before. */
  back?: boolean;
}

const inputPrompt = createPrompt<
  InputResult,
  {
    message: string;
    defaultValue?: string;
    validate?: (value: string) => string | boolean;
    body: string[];
    esc: string;
    back: boolean;
    secret: boolean;
    header?: () => string[];
    subscribe?: (redraw: () => void) => () => void;
    t: Tokens;
  }
>(({ message, defaultValue, validate, body, esc, back, secret, header, subscribe, t }, done) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [finished, setFinished] = useState(false);
  const finish = (result: InputResult) => {
    setFinished(true);
    done(result);
  };
  useCancelOnClose(() => done({ value: '', cancelled: true }));
  useRedraws(subscribe);

  // The default is typed in for you, to keep or edit.
  useEffect(rl => {
    if (!defaultValue) return;
    rl.write(defaultValue);
    setValue(defaultValue);
  }, []);

  useKeypress((key, rl) => {
    if (finished) return;
    if (isEnterKey(key)) {
      const valid = validate ? validate(value) : true;
      if (valid === true) {
        finish({ value, cancelled: false });
      } else {
        // Enter took the line; put it back to fix.
        rl.write(value);
        setError(typeof valid === 'string' ? valid : 'That isn’t valid');
      }
    } else if (isEscape(key)) {
      // Ctrl+C still cancels, as it ends the prompt another way.
      finish(back ? { value: '', cancelled: false, back } : { value: '', cancelled: true });
    } else {
      setError();
      setValue(rl.line);
    }
  });

  if (finished) return '';
  // The line being typed ends the question, where the terminal's cursor is.
  const shown = secret ? glyphs.secret.repeat(value.length) : value;
  return [
    `${above(header)}${t.strong(message)}${body.length > 0 ? `\n${body.join('\n')}` : ''}\n\n${t.accent(glyphs.pointer)} ${shown}`,
    `${error ? `\n${t.danger(error)}` : ''}\n${keysLine(t, ['enter submit', `esc ${back ? 'back' : esc}`])}`,
  ];
});

/**
 * Ask for a line of text, with any lines of `body` under the question. The
 * answer stays on screen, unless `clear`. With `back`, Esc answers `back`
 * rather than cancelling, and Ctrl+C still cancels. With `secret`, what's
 * typed is shown as a mark a character, like a token.
 */
export function input(
  message: string,
  {
    defaultValue,
    validate,
    body = [],
    header,
    subscribe,
    clear = false,
    signal,
    esc = 'cancel',
    back = false,
    secret = false,
    theme,
    terminal,
  }: {
    defaultValue?: string;
    validate?: (value: string) => string | boolean;
    body?: string[];
    back?: boolean;
    secret?: boolean;
  } & Around = {}
): Promise<InputResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context =>
      inputPrompt(
        { message, defaultValue, validate, body, esc, back, secret, header, subscribe, t },
        context
      ),
    { value: '', cancelled: true },
    clear
      ? undefined
      : ({ value }) =>
          `${t.strong(message)} ${t.muted(secret ? glyphs.secret.repeat(value.length) : value)}`,
    signal
  );
}
