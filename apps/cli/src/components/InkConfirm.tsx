import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { getTheme, type ChronicleTheme } from '../theme.js';

interface InkConfirmProps {
  message: string;
  defaultValue?: boolean;
  theme?: ChronicleTheme;
  onConfirm: (confirmed: boolean) => void;
  onCancel?: () => void;
}

const InkConfirmComponent: React.FC<InkConfirmProps> = ({
  message,
  defaultValue = false,
  theme,
  onConfirm,
  onCancel,
}) => {
  const [selected, setSelected] = useState<boolean>(defaultValue);

  useInput((input, key) => {
    if (key.return) {
      onConfirm(selected);
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.();
    } else if (input === 'y' || input === 'Y') {
      setSelected(true);
    } else if (input === 'n' || input === 'N') {
      setSelected(false);
    } else if (key.leftArrow || key.rightArrow) {
      setSelected(prev => !prev);
    }
  });

  const colors = {
    text: 'white',
    textDim: 'gray',
    success: 'green',
    error: 'red',
    primary: 'blue',
  };

  return (
    <Box flexDirection="column">
      <Text color={colors.text} bold>
        {message}
      </Text>
      <Text> </Text>

      <Box>
        <Text color={colors.primary}>❯ </Text>
        <Text
          color={selected ? colors.success : colors.textDim}
          backgroundColor={selected ? undefined : undefined}
        >
          Yes
        </Text>
        <Text color={colors.textDim}> / </Text>
        <Text
          color={selected ? colors.textDim : colors.error}
          backgroundColor={selected ? undefined : undefined}
        >
          No
        </Text>
        <Text color={colors.textDim}> ({selected ? 'Yes' : 'No'})</Text>
      </Box>

      <Text> </Text>
      <Text color={colors.textDim}>Use y/n, ←/→ to toggle, Enter to confirm, Esc to cancel</Text>
    </Box>
  );
};

export interface InkConfirmResult {
  confirmed: boolean;
  cancelled: boolean;
}

export function inkConfirm(
  message: string,
  options: {
    defaultValue?: boolean;
    theme?: string;
  } = {}
): Promise<InkConfirmResult> {
  return new Promise(resolve => {
    const theme = getTheme(options.theme || 'default');

    const handleConfirm = (confirmed: boolean) => {
      app.unmount();
      resolve({ confirmed, cancelled: false });
    };

    const handleCancel = () => {
      app.unmount();
      resolve({ confirmed: false, cancelled: true });
    };

    const app = render(
      <InkConfirmComponent
        message={message}
        defaultValue={options.defaultValue}
        theme={theme}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  });
}
