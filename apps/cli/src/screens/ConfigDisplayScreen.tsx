import React from 'react';
import { render, Box, Text } from 'ink';
import { getTheme, type ChronicleTheme } from '../theme.js';

interface ConfigData {
  version: string;
  global?: Record<string, any>;
  presets?: Record<
    string,
    {
      description?: string;
      flags: Record<string, any>;
    }
  >;
}

interface InkConfigDisplayProps {
  config: ConfigData;
  configPath: string;
  theme?: ChronicleTheme;
}

const formatValue = (value: any): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return value.toString();
  return JSON.stringify(value);
};

const InkConfigDisplayComponent: React.FC<InkConfigDisplayProps> = ({
  config,
  configPath,
  theme,
}) => {
  const currentTheme = theme || getTheme('default');

  return (
    <Box flexDirection="column">
      {/* Title */}
      <Text color={currentTheme.colors.secondary} bold>
        Chronicle Configuration
      </Text>
      <Text color={currentTheme.colors.secondary}>
        {'='.repeat('Chronicle Configuration'.length)}
      </Text>
      <Text> </Text>

      {/* Basic Info */}
      <Box flexDirection="column">
        <Box>
          <Text color={currentTheme.colors.primary} bold>
            Version:{' '}
          </Text>
          <Text color={currentTheme.colors.success}>{config.version}</Text>
        </Box>
        <Box>
          <Text color={currentTheme.colors.primary} bold>
            Config file:{' '}
          </Text>
          <Text color={currentTheme.colors.textDim}>{configPath}</Text>
        </Box>
      </Box>
      <Text> </Text>

      {/* Global Settings */}
      <Text color={currentTheme.colors.primary} bold>
        Global Settings:
      </Text>
      {config.global && Object.keys(config.global).length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {Object.entries(config.global).map(([key, value]) => (
            <Box key={key}>
              <Text color={currentTheme.colors.accent}>{key}: </Text>
              <Text color={currentTheme.colors.text}>{formatValue(value)}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginLeft={2}>
          <Text color={currentTheme.colors.textDim}>(none)</Text>
        </Box>
      )}
      <Text> </Text>

      {/* Presets */}
      <Text color={currentTheme.colors.primary} bold>
        Presets:
      </Text>
      {config.presets && Object.keys(config.presets).length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {Object.entries(config.presets).map(([name, preset]) => {
            const flagCount = Object.keys(preset.flags).length;
            const description = preset.description || '';

            return (
              <Box key={name} flexDirection="column">
                <Box>
                  <Text color={currentTheme.colors.accent} bold>
                    {name}
                  </Text>
                  <Text color={currentTheme.colors.textDim}> ({flagCount} flags)</Text>
                  {description && (
                    <>
                      <Text color={currentTheme.colors.textDim}> - </Text>
                      <Text color={currentTheme.colors.text}>{description}</Text>
                    </>
                  )}
                </Box>

                {/* Show preset flags */}
                <Box flexDirection="column" marginLeft={2}>
                  {Object.entries(preset.flags).map(([flagKey, flagValue]) => (
                    <Box key={flagKey}>
                      <Text color={currentTheme.colors.textDim}> --{flagKey}: </Text>
                      <Text color={currentTheme.colors.text}>{formatValue(flagValue)}</Text>
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box marginLeft={2}>
          <Text color={currentTheme.colors.textDim}>(none)</Text>
        </Box>
      )}
    </Box>
  );
};

export function renderInkConfigDisplay(
  config: ConfigData,
  configPath: string,
  options: {
    theme?: string;
  } = {}
): void {
  const theme = getTheme(options.theme || 'default');

  const app = render(
    <InkConfigDisplayComponent config={config} configPath={configPath} theme={theme} />
  );

  // Auto-unmount after rendering (for CLI display)
  setTimeout(() => {
    app.unmount();
  }, 100);
}
