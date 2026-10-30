import {
  AbortPromptError,
  ExitPromptError,
  createPrompt,
  isEnterKey,
  isSpaceKey,
  useEffect,
  useKeypress,
  useState,
  type KeypressEvent,
} from '@inquirer/core';
import { emitKeypressEvents } from 'node:readline';
import { EXIT_CODES } from '@chronicle.app/logging';
import { glyphs } from './glyphs.js';
import { canAsk } from './sinks.js';
import { tokens, type Tokens } from './tokens.js';

/**
 * Questions asked at a terminal: `confirm`, `proceed`, `select`,
 * `multiSelect`, and `input`, and `awaitEnter` for one drawn elsewhere. Each draws on stderr, so stdout stays for records, and reads keys
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
function optionRow(t: Tokens, option: SelectOption, here: boolean, mark = '') {
  const row = `${here ? glyphs.pointer : ' '} ${mark}${option.label}`;
  return (
    (here ? t.accent(row) : row) + (option.description ? t.muted(` ${option.description}`) : '')
  );
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
}

const proceedPrompt = createPrompt<ProceedResult, { message: string; t: Tokens }>(
  ({ message, t }, done) => {
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
    });

    if (finished) return '';
    return [
      // Apart from what it follows, which says what Enter goes on to.
      `\n${t.accent(glyphs.pointer)} ${t.strong(message)}${HIDE_CURSOR}`,
      `\n${keysLine(t, ['enter continue', 'esc cancel'])}`,
    ];
  }
);

/** Wait for Enter, saying what it does: `Press Enter to start`. The question clears once answered. */
export function proceed(
  message: string,
  { theme, terminal }: { theme?: string; terminal?: Terminal } = {}
): Promise<ProceedResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(terminal, context => proceedPrompt({ message, t }, context), { cancelled: true });
}

/**
 * Wait for Enter, drawing nothing, for a question something else draws as
 * it goes on, like the splash's `Press Enter to start`. True for Enter;
 * false for Esc, Ctrl+C, or Ctrl+D, which cancel. Without a terminal it
 * fails, as every question does.
 */
export function awaitEnter(input: NodeJS.ReadStream = process.stdin): Promise<boolean> {
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
    const done = (entered: boolean) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      resolve(entered);
    };
    const onKey = (_: string, key: KeypressEvent | undefined) => {
      if (!key) return;
      if (isEnterKey(key)) done(true);
      else if (isEscape(key) || (key.ctrl && (key.name === 'c' || key.name === 'd'))) done(false);
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

/** The question, any lines under it, and its options, the chosen ones filled. */
function choices(
  t: Tokens,
  message: string,
  options: SelectOption[],
  chosen: string[],
  cursor?: number,
  body: string[] = []
) {
  const rule = t.muted(`  ${'─'.repeat(Math.max(0, ...options.map(o => o.label.length)) + 2)}`);
  const rows = options.flatMap((option, i) => {
    const mark = option.action
      ? ' '
      : chosen.includes(option.value)
        ? glyphs.chosen
        : glyphs.unchosen;
    const row = optionRow(t, option, i === cursor, `${mark} `);
    return option.alone && i > 0 && !options[i - 1].alone ? [rule, row] : [row];
  });
  const said = body.length > 0 ? `\n${body.join('\n')}` : '';
  return `${t.strong(message)}${said}${rows.length > 0 ? `\n\n${rows.join('\n')}` : ''}`;
}

/**
 * Space toggles the highlighted option, and Enter starts: with nothing
 * toggled it takes just the highlighted one, so a single pick is one key,
 * or with `none`, nothing. Enter on an action takes what's toggled and the
 * action, as does a key action's key. A choice that stands alone clears the
 * others when it's toggled, and they it. `a` toggles all but those, `d`
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
    t: Tokens;
  }
>((props, done) => {
  const { message, options, defaults, initial, none, enter, skip, body, actions, esc } = props;
  const { back, onward, header, subscribe, t } = props;
  const [cursor, setCursor] = useState(0);
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
      const choosable = options
        .filter(option => !option.action && !option.alone)
        .map(option => option.value);
      setChosen(choosable.every(v => chosen.includes(v)) ? [] : choosable);
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
    ...(some ? ['a all'] : []),
    ...(defaults.length > 0 ? ['d defaults'] : []),
    `esc ${esc}`,
  ];
  return [
    `${above(header)}${choices(t, message, options, chosen, cursor, body)}${HIDE_CURSOR}`,
    `\n${keysLine(t, keys)}`,
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
    header?: () => string[];
    subscribe?: (redraw: () => void) => () => void;
    t: Tokens;
  }
>(({ message, defaultValue, validate, body, esc, back, header, subscribe, t }, done) => {
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
  return [
    `${above(header)}${t.strong(message)}${body.length > 0 ? `\n${body.join('\n')}` : ''}\n\n${t.accent(glyphs.pointer)} ${value}`,
    `${error ? `\n${t.danger(error)}` : ''}\n${keysLine(t, ['enter submit', `esc ${back ? 'back' : esc}`])}`,
  ];
});

/**
 * Ask for a line of text, with any lines of `body` under the question. The
 * answer stays on screen, unless `clear`. With `back`, Esc answers `back`
 * rather than cancelling, and Ctrl+C still cancels.
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
    theme,
    terminal,
  }: {
    defaultValue?: string;
    validate?: (value: string) => string | boolean;
    body?: string[];
    back?: boolean;
  } & Around = {}
): Promise<InputResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context =>
      inputPrompt(
        { message, defaultValue, validate, body, esc, back, header, subscribe, t },
        context
      ),
    { value: '', cancelled: true },
    clear ? undefined : ({ value }) => `${t.strong(message)} ${t.muted(value)}`,
    signal
  );
}
