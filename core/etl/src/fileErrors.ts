import { closeSync, openSync } from 'node:fs';
import { InputNotFound, PermissionDenied } from '@chronicle.app/logging';

const FULL_DISK_ACCESS =
  'Grant Full Disk Access to your terminal app, then restart it\nIt’s in System Settings → Privacy & Security → Full Disk Access';

/**
 * A filesystem error from reading `path` as the typed error it stands for:
 * missing is `InputNotFound`, refused is `PermissionDenied` (on macOS, a
 * refusal usually means the terminal lacks Full Disk Access). Anything else
 * comes back as it was. `what` names the input for the message: `database`,
 * `zsh history`.
 */
export function fileError(error: unknown, path: string, what = 'input'): unknown {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new InputNotFound(`No ${what} found`, { path, cause: error });
  }
  if (code === 'EPERM' || code === 'EACCES') {
    const macOSPrivacy = process.platform === 'darwin' && code === 'EPERM';
    return new PermissionDenied(
      macOSPrivacy ? `macOS blocked reading the ${what}` : `Can't read the ${what}`,
      {
        path,
        cause: error,
        hint: macOSPrivacy ? FULL_DISK_ACCESS : "Check the file's permissions",
      }
    );
  }
  return error;
}

/**
 * Open `path` for reading and close it again, so a missing or refused file
 * fails as a typed error before a library (SQLite, a parser) reports it as
 * something vaguer.
 */
export function assertReadable(path: string, what?: string): void {
  try {
    closeSync(openSync(path, 'r'));
  } catch (error) {
    throw fileError(error, path, what);
  }
}
