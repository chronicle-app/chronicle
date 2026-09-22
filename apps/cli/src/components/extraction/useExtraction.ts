import { useState, useCallback } from 'react';

interface ExtractionProgress {
  current: number;
  total: number;
  message?: string;
}

interface LogMessage {
  timestamp: Date;
  message: string;
}

interface ExtractionState {
  progress: ExtractionProgress;
  logs: LogMessage[];
  isComplete: boolean;
}

export const useExtraction = () => {
  const [state, setState] = useState<ExtractionState>({
    progress: { current: 0, total: 0 },
    logs: [],
    isComplete: false,
  });

  const updateProgress = useCallback((current: number, total: number, message?: string) => {
    setState(prev => ({
      ...prev,
      progress: { current, total, message },
      isComplete: current >= total && total > 0,
    }));
  }, []);

  const addLog = useCallback((message: string) => {
    setState(prev => ({
      ...prev,
      logs: [...prev.logs, { timestamp: new Date(), message }],
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      progress: { current: 0, total: 0 },
      logs: [],
      isComplete: false,
    });
  }, []);

  return {
    ...state,
    updateProgress,
    addLog,
    reset,
  };
};
