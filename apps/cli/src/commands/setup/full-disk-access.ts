import { execFile } from 'node:child_process';
import { opendirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Flags } from '@oclif/core';
import { terminalApp } from '@chronicle.app/etl';
import { BaseCommand } from '../../baseCommand.js';
import { canAsk } from '../../output/index.js';

const run = promisify(execFile);

/** The Full Disk Access list in System Settings. */
const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** Folders in the home folder that only Full Disk Access opens. */
const GUARDED = ['Library/Safari', 'Library/Messages', 'Library/Mail'];

/**
 * Whether this process has Full Disk Access, by opening the first guarded
 * folder that's there. Unknown when none is.
 */
function hasFullDiskAccess(home: string): boolean | undefined {
  for (const folder of GUARDED) {
    try {
      opendirSync(path.join(home, folder)).closeSync();
      return true;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'EPERM') return false;
    }
  }
  return undefined;
}

/**
 * The app bundle `pid` runs in, from `ps -A -o pid=,ppid=,comm=`: the
 * nearest ancestor that's an app, like `/Applications/Ghostty.app`. VS
 * Code's terminal runs in a helper app inside its own, so the outermost
 * bundle in the path is the app. None under tmux's server or ssh, which no
 * app started.
 */
export function appBundle(listing: string, pid: number): string | undefined {
  const processes = new Map<number, { parent: number; command: string }>();
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match) processes.set(Number(match[1]), { parent: Number(match[2]), command: match[3] });
  }
  const seen = new Set<number>();
  for (let at = processes.get(pid); at && !seen.has(at.parent); at = processes.get(at.parent)) {
    const bundle = /^(\/.*?\.app)\//.exec(at.command)?.[1];
    if (bundle) return bundle;
    seen.add(at.parent);
  }
  return undefined;
}

export default class FullDiskAccess extends BaseCommand<typeof FullDiskAccess> {
  static override summary = 'Give your terminal Full Disk Access for macOS sources';

  static override description =
    'macOS keeps Messages, Notes, Safari, and other apps’ data from programs without ' +
    'Full Disk Access. Chronicle runs in your terminal, so the terminal needs it. ' +
    'Says whether it has it, and if not, how to turn it on in System Settings, ' +
    'and offers to open it.';

  static override examples = [
    'chronicle setup full-disk-access',
    'chronicle setup full-disk-access --open',
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    open: Flags.boolean({ summary: 'Open System Settings without asking' }),
  };

  async run(): Promise<void> {
    if (process.platform !== 'darwin') {
      this.logger.info('Only macOS asks for Full Disk Access');
      return;
    }
    let bundle: string | undefined;
    try {
      bundle = appBundle((await run('ps', ['-A', '-o', 'pid=,ppid=,comm='])).stdout, process.pid);
    } catch {
      // Without it, the steps say to pick the app with +.
    }
    const app = terminalApp() ?? (bundle && path.basename(bundle, '.app')) ?? 'your terminal app';
    if (hasFullDiskAccess(os.homedir())) {
      this.summary(`Full Disk Access is on for ${app}`);
      return;
    }

    this.logger.emit({
      level: 'info',
      kind: 'guide',
      message: `Give ${app} Full Disk Access`,
      guide: {
        text: [
          `macOS keeps Messages, Notes, Safari, and other apps’ data from programs without Full Disk Access. Chronicle runs in ${app}, so ${app} needs it.`,
        ],
        steps: [
          'In System Settings, open Privacy & Security, then Full Disk Access.',
          `Turn on ${app}. If it isn’t listed, ` +
            (bundle
              ? `click + and pick ${bundle}, or drag it in from Finder.`
              : 'click + and pick it.'),
          `Quit ${app} and open it again. If macOS offers Quit & Reopen, use that.`,
          'Run `chronicle setup full-disk-access` to check.',
        ],
      },
    });
    this.logger.flush();

    let { open } = this.flags;
    if (!open && canAsk()) {
      const { confirm } = await import('../../output/prompts.js');
      ({ confirmed: open } = await confirm('Open Full Disk Access in System Settings?', {
        defaultValue: true,
        theme: this.flags.theme,
      }));
    } else if (!open) {
      this.hint('Use `--open` to open System Settings.');
    }
    if (!open) return;
    try {
      // Settings opens last, so its list is in front of the app in Finder.
      if (bundle) await run('open', ['-R', bundle]);
      await run('open', [SETTINGS_URL]);
    } catch (error) {
      this.logger.warn("Couldn't open System Settings", { error: String(error) });
    }
  }
}
