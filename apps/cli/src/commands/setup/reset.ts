import { BaseCommand } from '../../baseCommand.js';
import { ConfigManager } from '../../config/index.js';
import { count, plural } from '../../output/index.js';

/**
 * `chronicle setup reset`: forget what `chronicle setup` saved, so its next
 * run starts over. What it imported stays in the store.
 */
export default class SetupReset extends BaseCommand<typeof SetupReset> {
  static override hidden = true;

  static override summary = 'Forget what setup saved, so it starts over';

  static override description =
    'Forgets the sources picked, the folders to look in, the exports waited for, and what was put off. ' +
    'What setup imported stays in the store.';

  static override examples = ['chronicle setup reset'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const manager = new ConfigManager(this.config.configDir);
    const config = structuredClone(await manager.loadConfig());
    const picks = (config.targets ?? []).length;
    delete config.targets;
    delete config.folders;
    delete config.skipped;
    delete config.requested;
    delete config.wanted;
    delete config.later;
    await manager.saveConfig(config);
    this.summary(`Forgot ${count(picks)} ${plural('picks', picks)}`);
    if (picks > 0) this.hint('What setup imported stays in the store.');
  }
}
