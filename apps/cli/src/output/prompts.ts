import {
  ExitPromptError,
  createPrompt,
  isEnterKey,
  isSpaceKey,
  useEffect,
  useKeypress,
  useState,
  type KeypressEvent,
} from '@inquirer/core';
import { glyphs } from './glyphs.js';
import { tokens, type Tokens } from './tokens.js';

/**
 * Questions asked at a terminal: `confirm`, `select`, `multiSelect`, and
 * `input`. Each draws on stderr, so stdout stays for records, and reads keys
 * only while it's asking. Esc or Ctrl+C cancels. Callers check for a terminal
 * first and, without one, say which flag to pass instead.
 */

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

/** Hides the terminal's cursor while a list is up; the prompt shows it again when done. */
const HIDE_CURSOR = '\u001B[?25l';

/** Where a question is asked: stdin and stderr unless a test gives its own streams. */
export interface Terminal {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

const keysLine = (t: Tokens, keys: string[]) => t.muted(keys.join(` ${glyphs.bullet} `));
const isEscape = (key: KeypressEvent) => key.name === 'escape';
const isUp = (key: KeypressEvent) => key.name === 'up' || (key.name === 'k' && !key.ctrl);
const isDown = (key: KeypressEvent) => key.name === 'down' || (key.name === 'j' && !key.ctrl);

/**
 * Run a prompt on stderr. It clears itself when done, and an answer leaves
 * `answered`'s lines in its place; a cancel leaves nothing. Ctrl+C is a
 * cancel, not an error.
 */
async function ask<Value extends { cancelled: boolean }>(
  terminal: Terminal = {},
  run: (context: {
    input?: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
    clearPromptOnDone: boolean;
  }) => Promise<Value>,
  cancelled: Value,
  answered?: (value: Value) => string
): Promise<Value> {
  const output = terminal.output ?? process.stderr;
  let value: Value;
  try {
    value = await run({ input: terminal.input, output, clearPromptOnDone: true });
  } catch (error) {
    if (error instanceof ExitPromptError) return cancelled;
    throw error;
  }
  if (answered && !value.cancelled) output.write(`${answered(value)}\n`);
  return value;
}

/** Highlighted row first, then the option and what it is. */
function optionRow(t: Tokens, option: SelectOption, here: boolean, mark = '') {
  const row = `${here ? glyphs.pointer : ' '} ${mark}${option.label}`;
  return (
    (here ? t.accent(row) : row) + (option.description ? t.muted(` ${option.description}`) : '')
  );
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

  useKeypress(key => {
    if (finished) return;
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

export interface SelectResult {
  value: string;
  cancelled: boolean;
}

const selectPrompt = createPrompt<
  SelectResult,
  { message: string; options: SelectOption[]; defaultValue?: string; t: Tokens }
>(({ message, options, defaultValue, t }, done) => {
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

  useKeypress(key => {
    if (finished) return;
    if (isUp(key)) setCursor(cursor > 0 ? cursor - 1 : options.length - 1);
    else if (isDown(key)) setCursor(cursor < options.length - 1 ? cursor + 1 : 0);
    else if (isEnterKey(key)) finish({ value: options[cursor].value, cancelled: false });
    else if (isEscape(key)) finish({ value: '', cancelled: true });
  });

  if (finished) return '';
  const rows = options.map((option, i) => optionRow(t, option, i === cursor));
  return [
    `${t.strong(message)}\n\n${rows.join('\n')}${HIDE_CURSOR}`,
    `\n${keysLine(t, ['↑/↓ move', 'enter select', 'esc cancel'])}`,
  ];
});

/** Ask for one of `options`. The question clears once answered. */
export function select(
  message: string,
  options: SelectOption[],
  {
    defaultValue,
    theme,
    terminal,
  }: { defaultValue?: string; theme?: string; terminal?: Terminal } = {}
): Promise<SelectResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(terminal, context => selectPrompt({ message, options, defaultValue, t }, context), {
    value: '',
    cancelled: true,
  });
}

export interface MultiSelectResult {
  values: string[];
  cancelled: boolean;
}

/** The question and its options, the chosen ones filled. */
function choices(
  t: Tokens,
  message: string,
  options: SelectOption[],
  chosen: string[],
  cursor?: number
) {
  const rows = options.map((option, i) => {
    const mark = chosen.includes(option.value) ? glyphs.chosen : glyphs.unchosen;
    return optionRow(t, option, i === cursor, `${mark} `);
  });
  return `${t.strong(message)}\n\n${rows.join('\n')}`;
}

/**
 * Space toggles the highlighted option, and Enter starts: with nothing
 * toggled it takes just the highlighted one, so a single pick is one key. `a`
 * toggles all, `d` selects the defaults. (Shift+Enter can't be told from
 * Enter in most terminals, so it isn't used.)
 */
const multiSelectPrompt = createPrompt<
  MultiSelectResult,
  { message: string; options: SelectOption[]; defaults: string[]; t: Tokens }
>(({ message, options, defaults, t }, done) => {
  const [cursor, setCursor] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const finish = (result: MultiSelectResult) => {
    setFinished(true);
    done(result);
  };

  useKeypress(key => {
    if (finished) return;
    if (isUp(key)) setCursor(cursor > 0 ? cursor - 1 : options.length - 1);
    else if (isDown(key)) setCursor(cursor < options.length - 1 ? cursor + 1 : 0);
    else if (isSpaceKey(key)) {
      const { value } = options[cursor];
      setChosen(chosen.includes(value) ? chosen.filter(v => v !== value) : [...chosen, value]);
    } else if (key.name === 'a') {
      setChosen(chosen.length === options.length ? [] : options.map(option => option.value));
    } else if (key.name === 'd' && defaults.length > 0) {
      setChosen(defaults);
    } else if (isEnterKey(key)) {
      // In the order they're listed, not the order they were toggled.
      const picked = options.map(option => option.value).filter(v => chosen.includes(v));
      finish({ values: picked.length > 0 ? picked : [options[cursor].value], cancelled: false });
    } else if (isEscape(key)) {
      finish({ values: [], cancelled: true });
    }
  });

  if (finished) return '';
  const keys = [
    'space select',
    'enter start',
    'a all',
    ...(defaults.length > 0 ? ['d defaults'] : []),
    'esc cancel',
  ];
  return [
    `${choices(t, message, options, chosen, cursor)}${HIDE_CURSOR}`,
    `\n${keysLine(t, keys)}`,
  ];
});

/** Ask for one or more of `options`; `defaults` are what `d` selects. The picks stay on screen. */
export function multiSelect(
  message: string,
  options: SelectOption[],
  {
    defaults = [],
    theme,
    terminal,
  }: { defaults?: string[]; theme?: string; terminal?: Terminal } = {}
): Promise<MultiSelectResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context => multiSelectPrompt({ message, options, defaults, t }, context),
    { values: [], cancelled: true },
    ({ values }) => choices(t, message, options, values)
  );
}

export interface InputResult {
  value: string;
  cancelled: boolean;
}

const inputPrompt = createPrompt<
  InputResult,
  {
    message: string;
    defaultValue?: string;
    validate?: (value: string) => string | boolean;
    t: Tokens;
  }
>(({ message, defaultValue, validate, t }, done) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [finished, setFinished] = useState(false);
  const finish = (result: InputResult) => {
    setFinished(true);
    done(result);
  };

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
      finish({ value: '', cancelled: true });
    } else {
      setError();
      setValue(rl.line);
    }
  });

  if (finished) return '';
  // The line being typed ends the question, where the terminal's cursor is.
  return [
    `${t.strong(message)}\n\n${t.accent(glyphs.pointer)} ${value}`,
    `${error ? `\n${t.danger(error)}` : ''}\n${keysLine(t, ['enter submit', 'esc cancel'])}`,
  ];
});

/** Ask for a line of text. */
export function input(
  message: string,
  {
    defaultValue,
    validate,
    theme,
    terminal,
  }: {
    defaultValue?: string;
    validate?: (value: string) => string | boolean;
    theme?: string;
    terminal?: Terminal;
  } = {}
): Promise<InputResult> {
  const t = tokens({ stream: 'stderr', theme });
  return ask(
    terminal,
    context => inputPrompt({ message, defaultValue, validate, t }, context),
    { value: '', cancelled: true },
    ({ value }) => `${t.strong(message)} ${t.muted(value)}`
  );
}
