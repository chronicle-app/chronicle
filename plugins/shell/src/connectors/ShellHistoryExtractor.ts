import { Extractor, Record } from '@chronicle.app/etl';
import { readFile, access } from 'node:fs/promises';
import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';
import ShellHistoryTransformer from './ShellHistoryTransformer.js';

const SUPPORTED_SHELLS = ['auto', 'zsh', 'bash', 'fish'] as const;

interface HistoryEntry {
  data: {
    command: string;
    timestamp: string | null;
    originalLine: string;
    shell: string;
    historyFile: string;
  };
  metadata: {
    lineNumber: number;
    hasTimestamp: boolean;
    format?: string;
  };
}

export class ShellHistoryExtractor extends Extractor<typeof ShellHistoryExtractor> {
  static override source = 'shell';
  static override description = 'Command history (bash or zsh, auto-detected)';

  static override delivery = 'local' as const;
  static override strategy = 'history';
  static override recordTypes = ['commands'];
  static override default = true;
  static override defaultTransformer = ShellHistoryTransformer;

  static override schema = Extractor.schema.extend({
    shell: z
      .enum(SUPPORTED_SHELLS)
      .default('auto')
      .describe('Shell type to extract from (auto-detects if not specified)'),
    input: z
      .string()
      .optional()
      .describe(
        'Path to the shell history file (auto-detects based on shell type if not specified)'
      ),
  });

  private async detectShellType(): Promise<'zsh' | 'bash' | 'fish'> {
    if (this.config.input) {
      const content = await readFile(this.config.input, 'utf8');
      if (/^: \d+:\d+;/m.test(content)) return 'zsh';
      if (/^- cmd: /m.test(content)) return 'fish';
      if (/^#\d+$/m.test(content)) return 'bash';
      return path.basename(this.config.input).includes('zsh') ? 'zsh' : 'bash';
    }
    const homeDir = os.homedir();

    // Check for common shell history files in order of preference
    const shellChecks = [
      { shell: 'zsh' as const, path: path.join(homeDir, '.zsh_history') },
      { shell: 'bash' as const, path: path.join(homeDir, '.bash_history') },
      {
        shell: 'fish' as const,
        path: path.join(homeDir, '.local/share/fish/fish_history'),
      },
    ];

    for (const { shell, path: filePath } of shellChecks) {
      try {
        await access(filePath);
        return shell;
      } catch {
        // File doesn't exist, continue to next
      }
    }

    // Fallback to environment variable or default to zsh
    const shellEnv = process.env.SHELL?.toLowerCase() || '';
    if (shellEnv.includes('zsh')) return 'zsh';
    if (shellEnv.includes('bash')) return 'bash';
    if (shellEnv.includes('fish')) return 'fish';

    // Default fallback
    return 'zsh';
  }

  private getDefaultHistoryPath(shellType: string): string {
    const homeDir = os.homedir();
    switch (shellType) {
      case 'zsh':
        return path.join(homeDir, '.zsh_history');
      case 'bash':
        return path.join(homeDir, '.bash_history');
      case 'fish':
        return path.join(homeDir, '.local/share/fish/fish_history');
      default:
        return path.join(homeDir, '.zsh_history');
    }
  }

  override async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof ShellHistoryExtractor.schema>;

    // Determine shell type
    const shellType = config.shell === 'auto' ? await this.detectShellType() : config.shell;

    // Determine input file path
    const inputPath = config.input || this.getDefaultHistoryPath(shellType);

    try {
      const content = await readFile(inputPath, 'utf-8');

      // Delegate to appropriate parser
      switch (shellType) {
        case 'zsh':
          yield* this.parseZshHistory(content, inputPath);
          break;
        case 'bash':
          yield* this.parseBashHistory(content, inputPath);
          break;
        case 'fish':
          yield* this.parseFishHistory(content, inputPath);
          break;
        default:
          throw new Error(`Unsupported shell type: ${shellType}`);
      }
    } catch (error) {
      throw new Error(`Failed to read ${shellType} history file from ${inputPath}: ${error}`);
    }
  }

  /**
   * Yield parsed entries newest-first so `--limit` caps the most recent
   * commands. History files are append-only logs (oldest at the top), so
   * this is a reversal of file order.
   */
  private async *yieldNewestFirst(entries: HistoryEntry[]): AsyncGenerator<Record> {
    let commandCount = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (this.shouldStopExtracting(commandCount)) break;
      const { data, metadata } = entries[i];
      if (this.config.since || this.config.until) {
        if (!data.timestamp) continue;
        const time = new Date(data.timestamp).getTime();
        if (this.config.since && time < this.config.since.getTime()) continue;
        if (this.config.until && time > this.config.until.getTime()) continue;
      }
      yield this.createRecord(data, metadata);
      commandCount++;
    }
  }

  private async *parseZshHistory(content: string, inputPath: string): AsyncGenerator<Record> {
    const lines = content.split('\n').filter(line => line.trim());
    const entries: HistoryEntry[] = [];

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;

      // Parse zsh extended history format: : <timestamp>:<elapsed>;<command>
      const zshExtendedMatch = line.match(/^: (\d+):\d+;(.*)$/);

      let command: string;
      let timestamp: string | null;

      if (zshExtendedMatch) {
        const [, timestampStr, cmd] = zshExtendedMatch;
        const parsedTimestamp = Number.parseInt(timestampStr, 10);
        if (Number.isNaN(parsedTimestamp)) {
          timestamp = null;
        } else {
          try {
            timestamp = new Date(parsedTimestamp * 1000).toISOString();
          } catch {
            timestamp = null;
          }
        }
        command = cmd.trim();
      } else {
        command = line.trim();
        timestamp = null;
      }

      if (!command) continue;

      entries.push({
        data: {
          command,
          timestamp,
          originalLine: line,
          shell: 'zsh',
          historyFile: inputPath,
        },
        metadata: {
          lineNumber: index + 1,
          hasTimestamp: zshExtendedMatch !== null,
          format: zshExtendedMatch ? 'extended' : 'simple',
        },
      });
    }

    yield* this.yieldNewestFirst(entries);
  }

  private async *parseBashHistory(content: string, inputPath: string): AsyncGenerator<Record> {
    const lines = content.split('\n').filter(line => line.trim());
    let currentTimestamp: number | null = null;
    const entries: HistoryEntry[] = [];

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;

      // Check if this is a timestamp line (starts with #)
      if (line.startsWith('#')) {
        const timestampStr = line.slice(1);
        const parsedTimestamp = /^\d+$/.test(timestampStr) ? Number(timestampStr) : Number.NaN;
        currentTimestamp = Number.isNaN(parsedTimestamp) ? null : parsedTimestamp;
        continue;
      }

      const command = line.trim();

      // Create timestamp
      let timestamp: string | null;
      if (currentTimestamp !== null && !Number.isNaN(currentTimestamp)) {
        try {
          timestamp = new Date(currentTimestamp * 1000).toISOString();
        } catch {
          timestamp = null;
        }
      } else {
        timestamp = null;
      }

      entries.push({
        data: {
          command,
          timestamp,
          originalLine: line,
          shell: 'bash',
          historyFile: inputPath,
        },
        metadata: {
          lineNumber: index + 1,
          hasTimestamp: currentTimestamp !== null,
        },
      });
    }

    yield* this.yieldNewestFirst(entries);
  }

  private async *parseFishHistory(content: string, inputPath: string): AsyncGenerator<Record> {
    const lines = content.split('\n').filter(line => line.trim());
    const entries: HistoryEntry[] = [];
    let currentCommand = '';
    let currentTimestamp: string | null = null;

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;

      if (line.startsWith('- cmd: ')) {
        currentCommand = line.slice(7); // Remove "- cmd: "
      } else if (line.startsWith('  when: ')) {
        const timestampStr = line.slice(8); // Remove "  when: "
        const parsedTimestamp = Number.parseInt(timestampStr, 10);
        try {
          currentTimestamp = new Date(parsedTimestamp * 1000).toISOString();
        } catch {
          currentTimestamp = null;
        }

        // We have both command and timestamp, record the entry
        if (currentCommand) {
          entries.push({
            data: {
              command: currentCommand,
              timestamp: currentTimestamp,
              originalLine: `${currentCommand} (${currentTimestamp})`,
              shell: 'fish',
              historyFile: inputPath,
            },
            metadata: {
              lineNumber: index + 1,
              hasTimestamp: true,
            },
          });

          currentCommand = '';
          currentTimestamp = null;
        }
      }
    }

    yield* this.yieldNewestFirst(entries);
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof ShellHistoryExtractor.schema>;

    try {
      const shellType = config.shell === 'auto' ? await this.detectShellType() : config.shell;
      const inputPath = config.input || this.getDefaultHistoryPath(shellType);
      const content = await readFile(inputPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      switch (shellType) {
        case 'zsh':
          return lines.filter(line => {
            const trimmed = line.trim();
            return trimmed && (trimmed.match(/^: \d+:\d+;/) || !trimmed.startsWith(':'));
          }).length;

        case 'bash':
          return lines.filter(line => !line.startsWith('#')).length;

        case 'fish':
          return lines.filter(line => line.startsWith('- cmd: ')).length;

        default:
          return lines.length;
      }
    } catch {
      return null;
    }
  }
}
