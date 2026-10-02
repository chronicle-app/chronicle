import React, { useEffect, useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { glyphs, tokens, type Tokens } from '../output/index.js';
import type { SelectOption } from './InkSelect.js';

interface InkMultiSelectProps {
  message: string;
  options: SelectOption[];
  /** Values `d` selects, when there are some. */
  defaults: string[];
  onDone: (values: string[]) => void;
  onCancel: () => void;
  t: Tokens;
}

/**
 * Pick several options. Space toggles the highlighted one, Enter starts: with
 * nothing toggled it takes just the highlighted one, so a single pick is one
 * key. `a` toggles all, `d` selects the defaults, Esc cancels. (Shift+Enter
 * can't be told from Enter in most terminals, so it isn't used.)
 */
const InkMultiSelectComponent: React.FC<InkMultiSelectProps> = ({
  message,
  options,
  defaults,
  onDone,
  onCancel,
  t,
}) => {
  const [cursor, setCursor] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // Once started: what was picked, drawn filled before the picker finishes, so
  // the last frame left on screen shows it.
  const [started, setStarted] = useState<string[] | null>(null);
  useEffect(() => {
    if (started) onDone(started);
  }, [started]);

  const toggle = (value: string) =>
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  useInput((input, key) => {
    if (started) return;
    if (key.upArrow || input === 'k') {
      setCursor(prev => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow || input === 'j') {
      setCursor(prev => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (input === ' ') {
      toggle(options[cursor].value);
    } else if (input === 'a') {
      setChosen(prev =>
        prev.size === options.length ? new Set() : new Set(options.map(o => o.value))
      );
    } else if (input === 'd' && defaults.length > 0) {
      setChosen(new Set(defaults));
    } else if (key.return) {
      // In the order they're listed, not the order they were toggled.
      const picked = options.map(o => o.value).filter(value => chosen.has(value));
      const values = picked.length > 0 ? picked : [options[cursor].value];
      setChosen(new Set(values));
      setStarted(values);
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
    }
  });

  const keys = [
    'space select',
    'enter start',
    'a all',
    ...(defaults.length > 0 ? ['d defaults'] : []),
    'esc cancel',
  ];
  return (
    <Box flexDirection="column">
      <Text>{t.strong(message)}</Text>
      <Text> </Text>
      {options.map((option, index) => {
        const here = !started && index === cursor;
        const mark = chosen.has(option.value) ? glyphs.chosen : glyphs.unchosen;
        const row = `${here ? glyphs.pointer : ' '} ${mark} ${option.label}`;
        return (
          <Text key={option.value}>
            {here ? t.accent(row) : row}
            {option.description ? t.muted(` ${option.description}`) : ''}
          </Text>
        );
      })}
      <Text> </Text>
      {!started && <Text>{t.muted(keys.join(` ${glyphs.bullet} `))}</Text>}
    </Box>
  );
};

export interface InkMultiSelectResult {
  values: string[];
  cancelled: boolean;
}

/** Ask for one or more of `options`, on stderr so stdout stays for records. */
export function inkMultiSelect(
  message: string,
  options: SelectOption[],
  defaults: string[] = [],
  theme?: string
): Promise<InkMultiSelectResult> {
  return new Promise(resolve => {
    const finish = (result: InkMultiSelectResult) => {
      // Unmounting leaves the last frame: the picks, filled. A cancel clears it.
      if (result.cancelled) app.clear();
      app.unmount();
      resolve(result);
    };
    const app = render(
      <InkMultiSelectComponent
        message={message}
        options={options}
        defaults={defaults}
        t={tokens({ stream: 'stderr', theme })}
        onDone={values => finish({ values, cancelled: false })}
        onCancel={() => finish({ values: [], cancelled: true })}
      />,
      { stdout: process.stderr, exitOnCtrlC: false }
    );
  });
}
