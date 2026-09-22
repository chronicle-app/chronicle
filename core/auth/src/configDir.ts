import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The directory Chronicle keeps its config and credentials in — the same one
 * oclif resolves for `Config.configDir`, so code running outside an oclif
 * command (the agent harness, plugins' own tooling) reads the files that
 * `chronicle config set` and `chronicle auth set` write. `CHRONICLE_CONFIG_DIR`
 * is oclif's scoped override, then XDG_CONFIG_HOME / LOCALAPPDATA (Windows) /
 * ~/.config, mirroring `@oclif/core` `Config.dir('config')`.
 */
export function chronicleConfigDir(): string {
  return (
    process.env.CHRONICLE_CONFIG_DIR ||
    join(
      process.env.XDG_CONFIG_HOME ||
        (process.platform === 'win32' && process.env.LOCALAPPDATA) ||
        join(homedir(), '.config'),
      'chronicle'
    )
  );
}
