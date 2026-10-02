import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { glyphs, tokens, type Tokens } from '../output/index.js';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

interface InkSelectProps {
  message: string;
  options: SelectOption[];
  defaultValue?: string;
  t: Tokens;
  onSelect: (value: string) => void;
  onCancel?: () => void;
}

const InkSelectComponent: React.FC<InkSelectProps> = ({
  message,
  options,
  defaultValue,
  t,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (defaultValue) {
      const index = options.findIndex(option => option.value === defaultValue);
      return index >= 0 ? index : 0;
    }
    return 0;
  });

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      onSelect(options[selectedIndex].value);
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{t.strong(message)}</Text>
      <Text> </Text>
      {options.map((option, index) => {
        const here = index === selectedIndex;
        const row = `${here ? glyphs.pointer : ' '} ${option.label}`;
        return (
          <Text key={option.value}>
            {here ? t.accent(row) : row}
            {option.description ? t.muted(` ${option.description}`) : ''}
          </Text>
        );
      })}
      <Text> </Text>
      <Text>{t.muted(['↑/↓ move', 'enter select', 'esc cancel'].join(` ${glyphs.bullet} `))}</Text>
    </Box>
  );
};

export interface InkSelectResult {
  value: string;
  cancelled: boolean;
}

export function inkSelect(
  message: string,
  options: SelectOption[],
  defaultValue?: string,
  themeOption?: string
): Promise<InkSelectResult> {
  return new Promise(resolve => {
    const t = tokens({ stream: 'stderr', theme: themeOption });

    const handleSelect = (value: string) => {
      app.unmount();
      // Clear the terminal content to ensure selection UI disappears
      process.stderr.write('\u001B[2J\u001B[0f');
      resolve({ value, cancelled: false });
    };

    const handleCancel = () => {
      app.unmount();
      // Clear the terminal content to ensure selection UI disappears
      process.stderr.write('\u001B[2J\u001B[0f');
      resolve({ value: '', cancelled: true });
    };

    const app = render(
      <InkSelectComponent
        message={message}
        options={options}
        defaultValue={defaultValue}
        t={t}
        onSelect={handleSelect}
        onCancel={handleCancel}
      />,
      { stdout: process.stderr, exitOnCtrlC: false }
    );
  });
}
