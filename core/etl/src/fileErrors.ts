import { closeSync, openSync } from 'node:fs';
import { InputNotFound, PermissionDenied } from '@chronicle.app/logging';

/** Apps a shell runs in, by bundle ID, named as System Settings lists them. */
const TERMINAL_APPS = new Map([
  ['com.apple.Terminal', 'Terminal'],
  ['com.googlecode.iterm2', 'iTerm'],
  ['com.mitchellh.ghostty', 'Ghostty'],
  ['dev.warp.Warp-Stable', 'Warp'],
  ['com.github.wez.wezterm', 'WezTerm'],
  ['org.alacritty', 'Alacritty'],
  ['net.kovidgoyal.kitty', 'kitty'],
  ['co.zeit.hyper', 'Hyper'],
  ['com.microsoft.VSCode', 'Visual Studio Code'],
  ['com.microsoft.VSCodeInsiders', 'Visual Studio Code - Insiders'],
  ['com.todesktop.230313mzl4w4u92', 'Cursor'],
  ['com.exafunction.windsurf', 'Windsurf'],
  ['dev.zed.Zed', 'Zed'],
  ['com.anthropic.claudefordesktop', 'Claude'],
]);

/**
 * The app macOS asks Full Disk Access of: the one the shell runs in, by the
 * bundle ID macOS starts it with. Unnamed when macOS didn't start the shell
 * (ssh, launchd) or the app isn't one listed.
 */
export function terminalApp(): string | undefined {
  const id = process.env.__CFBundleIdentifier;
  return id === undefined ? undefined : TERMINAL_APPS.get(id);
}

/** How to let the terminal read what macOS guards, as a hint. */
export const FULL_DISK_ACCESS = `Run \`chronicle setup full-disk-access\` to give ${terminalApp() ?? 'your terminal app'} Full Disk Access.`;

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
        hint: macOSPrivacy ? FULL_DISK_ACCESS : "Check the file's permissions.",
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
