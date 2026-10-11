import { BaseCommand } from '../../baseCommand.js';
import { TokenHelper } from '../../auth/index.js';
import { stdoutWidth, table, tokens } from '../../output/index.js';

export default class AuthList extends BaseCommand<typeof AuthList> {
  static override description = 'List the providers with stored credentials';

  static override examples = ['chronicle auth list'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    try {
      const providers = (await TokenHelper.listProvidersWithCredentials()).sort();
      if (providers.length === 0) {
        this.logger.info('No credentials stored');
        this.hint('Run `chronicle auth login --list` to see the providers you can sign in to.');
        return;
      }

      const rows: string[][] = [];
      for (const provider of providers) {
        const valid = await TokenHelper.hasValidCredentials(provider);
        rows.push([provider, valid ? 'valid' : 'expired']);
      }
      const t = tokens({ stream: 'stdout', theme: this.flags.theme });
      const { lines } = table({ headings: ['provider', 'status'], cells: rows }, t, stdoutWidth());
      for (const line of lines) this.log(line);
      this.hint(`Run \`chronicle auth status ${providers[0]}\` to see its details.`);
    } catch (error) {
      this.failFrom(error, "Couldn't list credentials");
    }
  }
}
