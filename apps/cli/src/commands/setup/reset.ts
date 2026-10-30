import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Flags } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { ConfigManager } from '../../config/index.js';
import { count, plural } from '../../output/index.js';
import { fromHome } from '../../plugins/scan.js';
import { setupFiles } from '../../setup/jobs.js';

/**
 * `chronicle setup reset`: forget what `chronicle setup` saved, so its next
 * run starts over. The files it extracted stay unless `--files` says to
 * delete them too.
 */
export default class SetupReset extends BaseCommand<typeof SetupReset> {
  static override hidden = true;

  static override summary = 'Forget what setup saved, so it starts over';

  static override description =
    'Forgets the sources picked, the folders to look in, the exports waited for, and what was put off. ' +
    'With `--files`, deletes the files it extracted too.';

  static override examples = ['chronicle setup reset', 'chronicle setup reset --files'];

  static override flags = {
    ...BaseCommand.baseFlags,
    files: Flags.boolean({ summary: 'Delete the extracted files too' }),
    output: Flags.string({
      char: 'o',
      summary: 'The folder setup wrote its files to, when it was given one',
      helpValue: '<folder>',
    }),
  };

  async run(): Promise<void> {
    const home = os.homedir();
    const manager = new ConfigManager(this.config.configDir);
    const config = structuredClone(await manager.loadConfig());
    const targets = config.targets ?? [];
    const picks = targets.length;
    delete config.targets;
    delete config.folders;
    delete config.skipped;
    delete config.requested;
    delete config.wanted;
    delete config.later;
    await manager.saveConfig(config);

    // Only a folder typed here: `chronicle config set output` names extract's file.
    const output = this.flagSources?.output?.source === 'explicit' ? this.flags.output : undefined;
    const root = output
      ? path.resolve(output.replace(/^~(?=$|\/)/, home))
      : path.join(this.config.dataDir, 'extracts');
    const files = setupFiles(root, targets);
    if (this.flags.files) {
      for (const file of files) rmSync(file, { force: true });
    }
    const deleted = this.flags.files ? files.length : 0;
    this.summary(
      `Forgot ${count(picks)} ${plural('picks', picks)}` +
        (deleted > 0 ? ` and deleted ${count(deleted)} ${plural('files', deleted)}` : '')
    );
    if (!this.flags.files && files.length > 0) {
      this.hint(
        `The files are still in ${fromHome(root, home)}. ` +
          'Run `chronicle setup reset --files` to delete them too.'
      );
    }
  }
}
