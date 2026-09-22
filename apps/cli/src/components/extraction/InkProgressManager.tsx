import React, { useState, useEffect } from 'react';
import { render, useInput } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { ExtractionProgressScreen } from '../../screens/ExtractionProgressScreen.js';
import { getTheme, type ChronicleTheme } from '../../theme.js';

interface LogMessage {
  timestamp: Date;
  message: string;
}

interface ExtractionProgress {
  current: number;
  total: number;
  message?: string;
  phase?: 'setup' | 'initializing' | 'extracting' | 'complete';
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

interface JobStep {
  name: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

interface ExtractionStats {
  processedCount: number;
  errorCount: number;
  totalTime: number;
  rate: number;
}

export class InkProgressManager {
  private progress: ExtractionProgress = { current: 0, total: 0 };
  private logs: LogMessage[] = [];
  private currentRecord: any = null;
  private loaderPayload: any = null;
  private stats: ExtractionStats | undefined = undefined;
  private jobDetails: JobDetails | undefined = undefined;
  private jobSteps: JobStep[] = [];
  private renderInstance: any = null;
  private isComplete = false;
  private processedCount = 0;
  private errorCount = 0;
  private startTime: number = 0;
  private theme: ChronicleTheme;
  private isStdoutMode: boolean = false;
  private updateCallback:
    | ((
        progress: ExtractionProgress,
        logs: LogMessage[],
        currentRecord: any,
        loaderPayload: any,
        stats: ExtractionStats | undefined,
        jobDetails: JobDetails | undefined,
        jobSteps: JobStep[],
        theme: ChronicleTheme,
        isStdoutMode: boolean
      ) => void)
    | null = null;

  constructor(
    private flags: any,
    private shouldShow: boolean,
    globalLogs?: Array<{ timestamp: Date; message: string }>,
    private onInterrupt?: () => void
  ) {
    this.startTime = Date.now();
    this.theme = getTheme(this.flags.theme);

    // Determine if we're in stdout mode (outputting data directly)
    this.isStdoutMode = this.determineStdoutMode();

    // Initialize job steps
    this.jobSteps = [
      { name: 'Setup configuration', status: 'pending' },
      { name: 'Initialize extractor', status: 'pending' },
      { name: 'Process records', status: 'pending' },
      { name: 'Complete extraction', status: 'pending' },
    ];

    // Use global logs if provided (already captured), otherwise set up our own capture
    if (globalLogs) {
      this.logs = [...globalLogs];
      // Don't set up console capture since it's already being handled globally
    } else if (this.shouldShow) {
      // Capture console output - will redirect to stderr when in stdout mode
      this.captureConsoleOutput();
    }
  }

  private captureConsoleOutput() {
    // Store original console methods
    this.originalConsoleMethods.log = console.log;
    this.originalConsoleMethods.error = console.error;
    this.originalConsoleMethods.warn = console.warn;

    const originalLog = this.originalConsoleMethods.log;
    const originalError = this.originalConsoleMethods.error;
    const originalWarn = this.originalConsoleMethods.warn;

    // Override console methods to capture ALL output for unified logging
    console.log = (...args: any[]) => {
      const message = args
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');

      // Capture everything except noise
      if (
        message &&
        !message.includes('ExperimentalWarning') &&
        !message.includes('(Use `node --trace-warnings')
      ) {
        this.addLog(message);
      }

      // In stdout mode, redirect all console.log to stderr to avoid contaminating data output
      if (this.isStdoutMode) {
        originalError.apply(console, args);
      } else {
        originalLog.apply(console, args);
      }
    };

    console.error = (...args: any[]) => {
      const message = args
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');

      // Capture ALL stderr output except warnings and noise
      if (
        message &&
        !message.includes('ExperimentalWarning') &&
        !message.includes('›   Warning:') &&
        !message.includes('(Use `node --trace-warnings')
      ) {
        // Handle specific initialization messages and update job steps
        if (message.includes('ℹ Initializing extraction')) {
          this.updateJobStep(1, 'running');
          this.addLog('Initializing extraction');
          this.triggerUpdate();
        } else if (message.includes('ℹ Pre-extracting all records')) {
          this.addLog('Pre-extracting all records');
          this.triggerUpdate();
        } else if (message.includes('ℹ Pre-extracted')) {
          const match = message.match(/ℹ Pre-extracted (\d+) records/);
          if (match) {
            this.progress.total = Number.parseInt(match[1]);
            this.addLog(`Pre-extracted ${match[1]} records`);
            this.updateJobStep(1, 'complete'); // Initialize complete
            this.updateJobStep(2, 'running'); // Processing running
            this.progress.phase = 'extracting';
            this.triggerUpdate();
          }
        } else if (message.includes('ℹ Starting teardown')) {
          this.addLog('Starting teardown');
          this.updateJobStep(2, 'complete'); // Processing complete
          this.updateJobStep(3, 'running'); // Teardown running
          this.triggerUpdate();
        } else if (message.includes('ℹ Teardown complete')) {
          this.addLog('Teardown complete');
          this.updateJobStep(3, 'complete'); // Teardown complete
          this.triggerUpdate();
        } else {
          // Log everything else
          this.addLog(message);
        }
      }

      originalError.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      const message = args
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      if (message && !message.includes('ExperimentalWarning') && !message.includes('Warning:')) {
        this.addLog(message);
      }
      originalWarn.apply(console, args);
    };
  }

  private determineStdoutMode(): boolean {
    // We're in stdout mode (should disable UI) if:
    // 1. stdout is not a TTY (being piped or redirected)
    // 2. OR output is explicitly set to 'stdout'
    // 3. OR using json/csv/yaml loader with no output file (outputting to stdout)

    if (!process.stdout.isTTY) return true;
    if (this.flags.output === 'stdout') return true;

    // For data loaders (json, csv, yaml), if no output file specified, we're outputting to stdout
    const loaderType = this.flags.loader;
    if (['json', 'csv', 'yaml'].includes(loaderType) && !this.flags.output) {
      return true;
    }

    return false;
  }

  showJobSetup(commandId: string, extractorName: string) {
    if (!this.shouldShow || this.isStdoutMode) return;

    this.jobDetails = {
      command: commandId,
      extractor: extractorName,
      limit: this.flags.limit || 0,
      output: this.flags.output || 'stdout',
      since: this.flags.since,
      until: this.flags.until,
    };

    // Update job steps with specific details
    const limitDesc = this.flags.limit === 0 ? 'all records' : `${this.flags.limit} records`;

    // Determine output destination based on loader and configuration
    let outputDesc = 'to stdout';
    if (this.flags.output) {
      outputDesc = `to ${this.flags.output}`;
    } else if (this.flags.loader === 'http' && this.flags.endpoint) {
      outputDesc = `to ${this.flags.endpoint}`;
    } else if (this.flags.loader === 'http' && this.flags['http-endpoint']) {
      outputDesc = `to ${this.flags['http-endpoint']}`;
    } else if (this.flags.loader && this.flags.loader !== 'json') {
      outputDesc = `via ${this.flags.loader} loader`;
    }

    // Get active transformers info
    const transformers = this.getActiveTransformers();
    const transformerDesc = transformers.length > 0 ? ` (${transformers.join(', ')})` : '';

    this.jobSteps = [
      { name: `Setup configuration for ${commandId}`, status: 'complete' },
      { name: `Initialize ${extractorName} extractor`, status: 'pending' },
      { name: `Process ${limitDesc} ${outputDesc}${transformerDesc}`, status: 'pending' },
      { name: 'Complete extraction', status: 'pending' },
    ];

    this.progress = {
      current: 0,
      total: 0,
      message: 'Starting extraction...',
      phase: 'initializing',
    };

    // No hardcoded logs - everything will be captured by console intercept

    // Render the Ink app directly - no setup phase
    this.renderApp();
  }

  private getActiveTransformers(): string[] {
    const transformers: string[] = [];

    if (this.flags.raw) {
      transformers.push('raw data');
      return transformers;
    }

    if (this.flags.fields) {
      const fieldList = Array.isArray(this.flags.fields)
        ? this.flags.fields.join(',')
        : this.flags.fields;
      transformers.push(`fields: ${fieldList}`);
    }

    if (this.flags.flatten) {
      transformers.push('flatten');
    }

    if (this.flags.sample) {
      const rate = Number.parseFloat(this.flags.sample);
      const percent = Math.round(rate * 100);
      transformers.push(`sample: ${percent}%`);
    }

    if (this.flags.delay) {
      const delayMs = this.flags.delay;
      const delayDesc = delayMs >= 1000 ? `${delayMs / 1000}s` : `${delayMs}ms`;
      transformers.push(`delay: ${delayDesc}`);
    }

    return transformers;
  }

  private updateJobStep(index: number, status: JobStep['status']) {
    if (this.jobSteps[index]) {
      this.jobSteps[index].status = status;
    }
  }

  initializeProgressBar(total: number) {
    if (!this.shouldShow || this.isStdoutMode) return;

    this.progress = { current: 0, total, message: 'Starting extraction...', phase: 'initializing' };
    this.updateJobStep(1, 'running'); // Initialize extractor running
    this.addLog('Initializing extraction');

    // If not already rendered, render the app
    if (this.renderInstance) {
      this.triggerUpdate();
    } else {
      this.renderApp();
    }
  }

  private renderApp() {
    const App = () => {
      useInput(
        (input, key) => {
          if (key.ctrl && input === 'c') this.onInterrupt?.();
        },
        { isActive: Boolean(process.stdin.isTTY) }
      );
      const [currentProgress, setCurrentProgress] = useState({ ...this.progress });
      const [currentLogs, setCurrentLogs] = useState([...this.logs]);
      const [currentRecord, setCurrentRecord] = useState(this.currentRecord);
      const [currentLoaderPayload, setCurrentLoaderPayload] = useState(this.loaderPayload);
      const [currentStats, setCurrentStats] = useState(this.stats);
      const [currentJobDetails, setCurrentJobDetails] = useState(this.jobDetails);
      const [currentJobSteps, setCurrentJobSteps] = useState([...this.jobSteps]);
      const [currentTheme, setCurrentTheme] = useState(this.theme);
      const [currentIsStdoutMode, setCurrentIsStdoutMode] = useState(this.isStdoutMode);

      useEffect(() => {
        // Set up callback for updates
        this.updateCallback = (
          newProgress: ExtractionProgress,
          newLogs: LogMessage[],
          newRecord: any,
          newLoaderPayload: any,
          newStats: ExtractionStats | undefined,
          newJobDetails: JobDetails | undefined,
          newJobSteps: JobStep[],
          newTheme: ChronicleTheme,
          newIsStdoutMode: boolean
        ) => {
          setCurrentProgress({ ...newProgress });
          setCurrentLogs([...newLogs]);
          setCurrentRecord(newRecord);
          setCurrentLoaderPayload(newLoaderPayload);
          setCurrentStats(newStats);
          setCurrentJobDetails(newJobDetails);
          setCurrentJobSteps([...newJobSteps]);
          setCurrentTheme(newTheme);
          setCurrentIsStdoutMode(newIsStdoutMode);
        };

        // Cleanup callback on unmount - delayed to allow final updates
        return () => {
          setTimeout(() => {
            this.updateCallback = null;
          }, 100);
        };
      }, []);

      return (
        <ThemeProvider theme={currentTheme.inkTheme}>
          <ExtractionProgressScreen
            progress={currentProgress}
            logs={currentLogs}
            currentRecord={currentRecord}
            loaderPayload={currentLoaderPayload}
            stats={currentStats}
            jobDetails={currentJobDetails}
            jobSteps={currentJobSteps}
            theme={currentTheme}
            isStdoutMode={currentIsStdoutMode}
            onExit={() => {
              this.renderInstance?.unmount();
              this.renderInstance = null;
            }}
          />
        </ThemeProvider>
      );
    };

    this.renderInstance = render(<App />, { stdout: process.stderr, exitOnCtrlC: false });
  }

  private triggerUpdate() {
    // In stdout mode, suppress all UI updates to avoid contaminating output
    if (this.isStdoutMode) {
      return;
    }

    if (this.updateCallback) {
      this.updateCallback(
        { ...this.progress },
        [...this.logs],
        this.currentRecord,
        this.loaderPayload,
        this.stats,
        this.jobDetails,
        [...this.jobSteps],
        this.theme,
        this.isStdoutMode
      );
    }
  }

  processLogEntry(log: any, isDebugMode: boolean) {
    // One RunLog per EXTRACTED record (payload-level results ride in
    // log.results), so progress counts records honestly under fan-out.
    if (log.record !== undefined && log.record !== null) {
      // Switch to extracting phase on first record
      if (this.progress.phase === 'initializing' || this.progress.phase === 'setup') {
        this.progress.phase = 'extracting';
        this.updateJobStep(1, 'complete'); // Initialize extractor complete
        this.updateJobStep(2, 'running'); // Process records running
      }

      this.processedCount += 1;
      this.progress.current = this.processedCount;
      this.progress.message = `Processed ${this.processedCount} records`;

      // Show the last loaded payload (falling back to the extracted record).
      const lastResult = log.results?.at(-1);
      if (lastResult?.record) {
        this.currentRecord = lastResult.record.data || lastResult.record;
        this.loaderPayload = lastResult;
      } else {
        this.currentRecord = log.record.data || log.record;
      }

      for (const result of log.results ?? []) {
        if (!result.success) {
          this.errorCount++;
          this.addLog(`Error loading record: ${result.error}`);
        }
      }
      for (const validationError of log.validationErrors ?? []) {
        this.errorCount++;
        this.addLog(`Schema validation failed for record: ${validationError}`);
      }
      if (log.filtered && isDebugMode) {
        this.addLog(`Filtered record ${this.processedCount} (transformer returned no payloads)`);
      }

      // Verbose logging for each record when in debug mode (suppress in stdout mode and quiet mode)
      if (isDebugMode && !this.isStdoutMode && !this.flags.quiet) {
        this.addLog(`Processing record ${this.processedCount}`);
      } else if (this.processedCount % 5 === 0 && !this.isStdoutMode && !this.flags.quiet) {
        // Log every 5 records in normal mode (suppress in stdout mode and quiet mode)
        this.addLog(`Processed ${this.processedCount} records`);
      }
    }

    if (log.error) {
      this.errorCount++;
      this.addLog(`Error: ${log.error}`);
    }

    if (log.message) {
      this.addLog(log.message);
    }

    // Enhanced debug logging
    if (isDebugMode) {
      if (log.debugInfo) {
        this.addLog(`Debug: ${log.debugInfo}`);
      }
      if (log.extractor) {
        this.addLog(`Extractor: ${log.extractor}`);
      }
      if (log.transformer) {
        this.addLog(`Transformer: ${log.transformer}`);
      }
      if (log.loader) {
        this.addLog(`Loader: ${log.loader}`);
      }
    }

    // Trigger UI update
    this.triggerUpdate();
  }

  private addLog(message: string) {
    // In stdout mode, suppress all logging to avoid contaminating output
    if (this.isStdoutMode) {
      return;
    }

    this.logs.push({
      timestamp: new Date(),
      message,
    });

    // Keep infinite scrollback - no limit on logs for full visibility
    // Users want to see all messages with infinite scrollback

    // Trigger UI update when adding logs
    this.triggerUpdate();
  }

  private outputToStdout(message: string) {
    // Output directly to stdout (bypasses console capture)
    process.stdout.write(`${message}\n`);
  }

  // Method to add logs from global capture while InkProgressManager is running
  addGlobalLog(message: string) {
    this.addLog(message);
  }

  stopProgressBar() {
    if (!this.shouldShow || this.isStdoutMode) return;

    // Calculate final stats
    const endTime = Date.now();
    const totalTime = endTime - this.startTime;
    const rate = totalTime > 0 ? this.processedCount / (totalTime / 1000) : 0;

    this.stats = {
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      totalTime,
      rate,
    };

    this.progress.phase = 'complete';
    this.progress.message = 'Extraction complete';
    this.currentRecord = null; // Clear current record when done

    // Ensure all job steps are marked complete
    this.updateJobStep(1, 'complete'); // Initialize extractor complete
    this.updateJobStep(2, 'complete'); // Process records complete
    this.updateJobStep(3, 'complete'); // Complete extraction complete

    this.isComplete = true;
    this.addLog('✓ Extraction complete!');

    // Force multiple updates to ensure React processes the completion state
    this.triggerUpdate();
    // Use setImmediate to ensure the update is processed
    setImmediate(() => {
      this.triggerUpdate();
    });
  }

  displayStats() {
    const endTime = Date.now();
    const totalTime = endTime - this.startTime;
    const rate = totalTime > 0 ? this.processedCount / (totalTime / 1000) : 0;

    // Don't restore console or unmount UI here - let ExtractCommand handle teardown
    // after the entire ETL process (including teardown) is complete

    if (!this.shouldShow && !this.flags.quiet) {
      // For non-interactive mode, just log stats to stderr (unless quiet)
      console.error(`\nProcessed: ${this.processedCount} records`);
      console.error(`Errors: ${this.errorCount}`);
      console.error(`Time: ${Math.round(totalTime / 1000)}s`);
      console.error(`Rate: ${Math.round(rate * 100) / 100} records/sec`);
    }

    return {
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      startTime: totalTime,
      rate,
    };
  }

  private originalConsoleMethods: {
    log?: typeof console.log;
    error?: typeof console.error;
    warn?: typeof console.warn;
  } = {};

  private restoreConsoleOutput() {
    if (this.originalConsoleMethods.log) {
      console.log = this.originalConsoleMethods.log;
    }
    if (this.originalConsoleMethods.error) {
      console.error = this.originalConsoleMethods.error;
    }
    if (this.originalConsoleMethods.warn) {
      console.warn = this.originalConsoleMethods.warn;
    }
  }

  addDataSeparator() {
    // In Ink mode, we don't need separators as UI is contained
    if (!this.shouldShow) {
      console.error('─'.repeat(50));
    }
  }

  // Method to properly tear down the UI after all ETL operations are complete
  async teardown() {
    // Minimal delay to ensure React has time to render completion state
    // In stdout mode, add extra delay to ensure all JSON output is flushed before UI cleanup
    let delay = this.progress.phase === 'complete' && this.stats ? 50 : 10;

    if (this.isStdoutMode) {
      delay = Math.max(delay, 100); // Ensure sufficient time for stdout flushing
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    this.performTeardown();
  }

  /**
   * Tear down synchronously — the error path. `teardown()` defers so a final
   * render can land; a failing run needs the console restored BEFORE the error
   * is printed, or the message is captured by the patched console and lost
   * with the unmounted UI.
   */
  teardownNow() {
    this.performTeardown();
  }

  private performTeardown() {
    // Restore original console methods
    this.restoreConsoleOutput();

    // Unmount Ink UI
    if (this.renderInstance) {
      this.renderInstance.unmount();
      this.renderInstance = null;
    }
  }

  private clearStderr() {
    // Clear the terminal screen on stderr to remove all UI traces
    if (process.stderr.isTTY) {
      // Move cursor to top of screen and clear everything below
      process.stderr.write('\u001B[H\u001B[2J');
    }
  }
}
