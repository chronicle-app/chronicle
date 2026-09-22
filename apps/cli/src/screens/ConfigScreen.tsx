import React from 'react';
import { Box, Text } from 'ink';
import type { ChronicleTheme } from '../theme.js';

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

interface ConfigScreenProps {
  config: ConfigData;
  configPath: string;
  theme: ChronicleTheme;
}

const formatValue = (value: any): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return value.toString();
  return JSON.stringify(value);
};

export const ConfigScreen: React.FC<ConfigScreenProps> = ({ config, configPath, theme }) => (
  <Box flexDirection="column">
    {/* Title */}
    <Text color={theme.colors.secondary} bold>
      Chronicle Configuration
    </Text>
    <Text color={theme.colors.textDim}>{'='.repeat('Chronicle Configuration'.length)}</Text>
    <Text> </Text>

    {/* Basic Info */}
    <Box flexDirection="column">
      <Box>
        <Text color={theme.colors.primary} bold>
          Version:{' '}
        </Text>
        <Text color={theme.colors.success}>{config.version}</Text>
      </Box>
      <Box>
        <Text color={theme.colors.primary} bold>
          Config file:{' '}
        </Text>
        <Text color={theme.colors.textDim}>{configPath}</Text>
      </Box>
    </Box>
    <Text> </Text>

    {/* Global Settings */}
    <Text color={theme.colors.primary} bold>
      Global Settings:
    </Text>
    {config.global && Object.keys(config.global).length > 0 ? (
      <Box flexDirection="column" marginLeft={2}>
        {Object.entries(config.global).map(([key, value]) => (
          <Box key={key}>
            <Text color={theme.colors.accent}>{key}: </Text>
            <Text>{formatValue(value)}</Text>
          </Box>
        ))}
      </Box>
    ) : (
      <Box marginLeft={2}>
        <Text color={theme.colors.textDim}>(none)</Text>
      </Box>
    )}
    <Text> </Text>

    {/* Presets */}
    <Text color={theme.colors.primary} bold>
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
                <Text color={theme.colors.accent} bold>
                  {name}
                </Text>
                <Text color={theme.colors.textDim}> ({flagCount} flags)</Text>
                {description && (
                  <>
                    <Text color={theme.colors.textDim}> - </Text>
                    <Text>{description}</Text>
                  </>
                )}
              </Box>

              {/* Show preset flags */}
              <Box flexDirection="column" marginLeft={2}>
                {Object.entries(preset.flags).map(([flagKey, flagValue]) => (
                  <Box key={flagKey}>
                    <Text color={theme.colors.textDim}> --{flagKey}: </Text>
                    <Text>{formatValue(flagValue)}</Text>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    ) : (
      <Box marginLeft={2}>
        <Text color={theme.colors.textDim}>(none)</Text>
      </Box>
    )}
  </Box>
);
