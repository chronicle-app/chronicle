import { Args } from '@oclif/core';
import { BaseCommand } from '../../baseCommand.js';
import { SPLASH_STYLES, Splash, tokens, type SplashStyleName } from '../../output/index.js';
import { INTRO } from '../../setup/intro.js';

/**
 * `chronicle setup splash [style]`: play the splash `chronicle setup` opens
 * with, each look in turn, or the one named, to compare them.
 */
export default class SetupSplash extends BaseCommand<typeof SetupSplash> {
  static override hidden = true;

  static override summary = 'Play the setup splash in each of its looks';

  static override examples = ['chronicle setup splash', 'chronicle setup splash manual'];

  static override args = {
    style: Args.string({
      description: 'A look to play',
      options: Object.keys(SPLASH_STYLES),
      required: false,
    }),
  };

  static override flags = { ...BaseCommand.baseFlags };

  async run(): Promise<void> {
    if (!Splash.fits()) {
      this.fail('The splash plays at a terminal', {
        hint: 'Run `chronicle setup splash` in a terminal window.',
      });
    }
    const t = tokens({ stream: 'stderr', theme: this.flags.theme });
    const names = (
      this.args.style ? [this.args.style] : Object.keys(SPLASH_STYLES)
    ) as SplashStyleName[];
    const { awaitEnter } = await import('../../output/prompts.js');
    for (const [i, name] of names.entries()) {
      const style = SPLASH_STYLES[name];
      process.stderr.write(`\n${t.muted(`${name}  ${style.summary}`)}\n\n`);
      const last = i === names.length - 1;
      const splash = new Splash(t, {
        style,
        intro: INTRO,
        prompt: last ? 'Press Enter to finish' : 'Press Enter for the next',
      });
      splash.start();
      let entered = false;
      try {
        entered = await awaitEnter();
      } finally {
        splash.end();
      }
      if (!entered) return;
    }
  }
}
