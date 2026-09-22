import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ProgressBar, Spinner } from '@inkjs/ui';
import type { ChronicleTheme } from '../theme.js';

// Compact JSON formatter - removes newlines to use horizontal space efficiently
function formatJSON(obj: any, maxLength = 800): string {
  const jsonStr = JSON.stringify(obj); // No indentation for compact display
  return jsonStr.length > maxLength ? jsonStr.slice(0, Math.max(0, maxLength)) + '...' : jsonStr;
}

interface ExtractionProgress {
  current: number;
  total: number;
  message?: string;
  phase?: 'setup' | 'initializing' | 'extracting' | 'complete';
}

interface JobStep {
  name: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

interface JobDetails {
  command: string;
  extractor: string;
  limit: number;
  output: string;
  since?: string;
  until?: string;
  [key: string]: any;
}

interface LogMessage {
  timestamp: Date;
  message: string;
}

interface ExtractionStats {
  processedCount: number;
  errorCount: number;
  totalTime: number;
  rate: number;
}

interface ExtractionProgressScreenProps {
  progress: ExtractionProgress;
  logs: LogMessage[];
  currentRecord?: any;
  loaderPayload?: any;
  stats?: ExtractionStats;
  jobDetails?: JobDetails;
  jobSteps?: JobStep[];
  theme: ChronicleTheme;
  onExit?: () => void;
  isStdoutMode?: boolean;
}

export const ExtractionProgressScreen: React.FC<ExtractionProgressScreenProps> = ({
  progress,
  logs,
  currentRecord,
  stats,
  jobSteps,
  theme,
  isStdoutMode = false,
}) => {
  // Ensure we have numbers, not objects
  const current = Number(progress.current) || 0;
  const total = Number(progress.total) || 0;

  useEffect(() => {
    if (progress.phase === 'complete' && stats) {
      // Let the teardown method handle the delay instead
    }
  }, [progress.phase, stats]);

  const percentage = total > 0 ? (current / total) * 100 : 0;

  // Use theme colors from the passed theme
  const colors = {
    primary: theme.colors.primary,
    secondary: theme.colors.secondary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
    text: theme.colors.text,
    textDim: theme.colors.textDim,
    accent: theme.colors.accent,
  };

  return (
    <Box flexDirection="column">
      {/* Verbose Log Messages - scroll off screen (hidden in stdout mode) */}
      {logs.length > 0 && !isStdoutMode && (
        <Box flexDirection="column" marginBottom={1}>
          {logs.map((log, index) => (
            <Text key={index} color={colors.textDim}>
              {log.timestamp.toLocaleTimeString()} - {log.message}
            </Text>
          ))}
        </Box>
      )}

      {/* Job Steps Status */}
      {jobSteps && (
        <Box flexDirection="column" marginBottom={1} marginTop={1}>
          <Text color={colors.textDim} bold>
            Job Progress:
          </Text>
          <Box flexDirection="column">
            {jobSteps.map((step, index) => (
              <Box key={index} flexDirection="row" columnGap={1}>
                <Text color="blue">{index + 1}.</Text>
                {step.status === 'running' && <Spinner type="dots" />}
                {step.status === 'complete' && <Text color={colors.success}>✓</Text>}
                {step.status === 'error' && <Text color={colors.error}>✗</Text>}
                {step.status === 'pending' && <Text color={colors.textDim}>○</Text>}
                <Text color={step.status === 'error' ? colors.error : colors.text}>
                  {step.name}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Current Record JSON - only show if not complete */}
      {currentRecord && progress.phase !== 'complete' && (
        <Box flexDirection="column" marginBottom={1} marginTop={1} height={6}>
          <Text color={colors.textDim} bold>
            Current Record:
          </Text>
          <Text color={theme.json.StringLiteral} wrap="wrap">
            {formatJSON(currentRecord, 800)}
          </Text>
        </Box>
      )}

      {/* Progress Bar - show during extraction */}
      {progress.phase === 'extracting' && (
        <Box flexDirection="column" marginBottom={1} marginTop={1}>
          <ProgressBar value={percentage} />
          <Text color={colors.textDim}>
            {Math.round(percentage)}% - Progress: {current}/{total}
          </Text>
        </Box>
      )}

      {/* Summary when complete - hide in stdout mode to avoid overlapping JSON output */}
      {progress.phase === 'complete' && !isStdoutMode && (
        <Box
          flexDirection="column"
          marginBottom={1}
          marginTop={1}
          borderStyle="single"
          borderColor={colors.primary}
          padding={1}
        >
          <Box marginBottom={1}>
            <Text color={colors.primary} bold>
              EXTRACTION COMPLETE
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text>Records: </Text>
            <Text>{stats?.processedCount || current || 0}</Text>
          </Box>
          <Box flexDirection="row">
            <Text>Errors: </Text>
            <Text>{stats?.errorCount || 0}</Text>
          </Box>
          <Box flexDirection="row">
            <Text>Duration: </Text>
            <Text>{stats ? Math.round(stats.totalTime / 1000) : 'N/A'}s</Text>
          </Box>
          <Box flexDirection="row">
            <Text>Rate: </Text>
            <Text>{stats ? Math.round(stats.rate * 100) / 100 : 'N/A'} rec/s</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
