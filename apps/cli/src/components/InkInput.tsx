import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { getTheme, type ChronicleTheme } from '../theme.js';

interface InkInputProps {
  message: string;
  defaultValue?: string;
  placeholder?: string;
  validate?: (input: string) => string | boolean;
  theme?: ChronicleTheme;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
}

const InkInputComponent: React.FC<InkInputProps> = ({
  message,
  defaultValue = '',
  placeholder = '',
  validate,
  theme,
  onSubmit,
  onCancel,
}) => {
  const [input, setInput] = useState(defaultValue);
  const [error, setError] = useState('');

  useInput((inputChar, key) => {
    if (key.return) {
      // Validate input
      if (validate) {
        const validationResult = validate(input);
        if (validationResult !== true) {
          setError(typeof validationResult === 'string' ? validationResult : 'Invalid input');
          return;
        }
      }

      setError('');
      onSubmit(input);
    } else if (key.escape || (key.ctrl && inputChar === 'c')) {
      onCancel?.();
    } else if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      setError('');
    } else if (inputChar && !key.ctrl && !key.meta) {
      setInput(prev => prev + inputChar);
      setError('');
    }
  });

  const colors = {
    text: 'white',
    textDim: 'gray',
    error: 'red',
    primary: 'blue',
  };

  const displayValue = input || placeholder;

  return (
    <Box flexDirection="column">
      <Text color={colors.text} bold>
        {message}
      </Text>
      <Text> </Text>

      <Box>
        <Text color={colors.primary}>❯ </Text>
        <Text color={input ? colors.text : colors.textDim}>
          {displayValue}
          <Text backgroundColor={colors.primary}> </Text>
        </Text>
      </Box>

      {error && (
        <>
          <Text> </Text>
          <Text color={colors.error}>{error}</Text>
        </>
      )}

      <Text> </Text>
      <Text color={colors.textDim}>Type your input, Enter to submit, Esc to cancel</Text>
    </Box>
  );
};

export interface InkInputResult {
  value: string;
  cancelled: boolean;
}

export function inkInput(
  message: string,
  options: {
    defaultValue?: string;
    placeholder?: string;
    validate?: (input: string) => string | boolean;
    theme?: string;
  } = {}
): Promise<InkInputResult> {
  return new Promise(resolve => {
    const theme = getTheme(options.theme || 'default');

    const handleSubmit = (value: string) => {
      app.unmount();
      resolve({ value, cancelled: false });
    };

    const handleCancel = () => {
      app.unmount();
      resolve({ value: '', cancelled: true });
    };

    const app = render(
      <InkInputComponent
        message={message}
        defaultValue={options.defaultValue}
        placeholder={options.placeholder}
        validate={options.validate}
        theme={theme}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />,
      { stdout: process.stderr, exitOnCtrlC: false }
    );
  });
}
