import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Data profile. The CLI's `bin/dev.js` sets `CHRONICLE_PROFILE=dev` so
 * development runs write to a separate data directory and can never touch
 * the installed CLI's store or plugins. `CHRONICLE_DATA_DIR`, `--db`, and
 * `CHRONICLE_DB` still override entirely.
 */
export function chronicleProfile(): 'dev' | 'production' {
  const profile = process.env.CHRONICLE_PROFILE?.toLowerCase();
  return profile === 'dev' || profile === 'development' ? 'dev' : 'production';
}

/**
 * The directory Chronicle keeps its data in: the store, and the plugins
 * `chronicle plugins install` adds. `CHRONICLE_DATA_DIR` is oclif's scoped
 * override; on macOS it's the conventional ~/Library/Application
 * Support/Chronicle, and elsewhere it's where oclif keeps data,
 * XDG_DATA_HOME / LOCALAPPDATA (Windows) / ~/.local/share, as
 * `chronicleConfigDir` mirrors oclif for config. The dev profile uses
 * "Chronicle Dev" (`chronicle-dev`) alongside it.
 */
export function chronicleDataDir(): string {
  if (process.env.CHRONICLE_DATA_DIR) return process.env.CHRONICLE_DATA_DIR;
  const dev = chronicleProfile() === 'dev';
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', dev ? 'Chronicle Dev' : 'Chronicle');
  }
  const base =
    process.env.XDG_DATA_HOME ||
    (process.platform === 'win32' && process.env.LOCALAPPDATA) ||
    join(homedir(), '.local', 'share');
  return join(base, dev ? 'chronicle-dev' : 'chronicle');
}
