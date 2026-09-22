import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { getTheme, type ChronicleTheme } from '../theme.js';

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

interface InkSelectProps {
  message: string;
  options: SelectOption[];
  defaultValue?: string;
  theme?: ChronicleTheme;
  onSelect: (value: string) => void;
  onCancel?: () => void;
}

const InkSelectComponent: React.FC<InkSelectProps> = ({
  message,
  options,
  defaultValue,
  theme,
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

  const colors = {
    primary: 'blue',
    text: 'white',
    textDim: 'gray',
    selected: 'green',
  };

  return (
    <Box flexDirection="column">
      <Text color={colors.text} bold>
        {message}
      </Text>
      <Text> </Text>

      {options.map((option, index) => (
        <Box key={option.value}>
          <Text color={index === selectedIndex ? colors.selected : colors.text}>
            {index === selectedIndex ? '❯ ' : '  '}
            {option.label}
            {option.description && <Text color={colors.textDim}> - {option.description}</Text>}
          </Text>
        </Box>
      ))}

      <Text> </Text>
      <Text color={colors.textDim}>Use ↑/↓ or j/k to navigate, Enter to select, Esc to cancel</Text>
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
    const theme = getTheme(themeOption || 'default');

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
        theme={theme}
        onSelect={handleSelect}
        onCancel={handleCancel}
      />,
      { stdout: process.stderr, exitOnCtrlC: false }
    );
  });
}
