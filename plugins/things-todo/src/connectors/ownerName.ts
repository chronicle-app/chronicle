import { execFileSync } from 'node:child_process';

export interface OwnerNameOptions {
  platform?: string;
  run?: (command: string, args: string[]) => string;
}

/**
 * The full name of the OS account running the extraction, as the owner of the
 * local Things database. On macOS this is the account's full name from
 * `id -F`. Returns undefined elsewhere or when the name is unset or unreadable.
 */
export function localAccountName(options: OwnerNameOptions = {}): string | undefined {
  if ((options.platform ?? process.platform) !== 'darwin') return undefined;
  const run =
    options.run ??
    ((command, args) =>
      execFileSync(command, args, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }));
  try {
    return run('/usr/bin/id', ['-F']).trim() || undefined;
  } catch {
    return undefined;
  }
}
