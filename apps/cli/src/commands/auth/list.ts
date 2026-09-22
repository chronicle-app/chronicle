import { BaseCommand } from '../../baseCommand.js';
import { TokenHelper } from '../../auth/index.js';
import { renderCredentialsScreen, type CredentialInfo } from '../../screens/index.js';

export default class AuthList extends BaseCommand<typeof AuthList> {
  static override description = 'List sources with stored credentials';

  static override examples = ['chronicle auth list'];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    try {
      const providers = await TokenHelper.listProvidersWithCredentials();

      const credentialInfos: CredentialInfo[] = [];
      for (const provider of providers.sort()) {
        const hasValid = await TokenHelper.hasValidCredentials(provider);
        credentialInfos.push({
          provider,
          isValid: hasValid,
          lastUsed: undefined,
          expiresAt: undefined,
        });
      }

      renderCredentialsScreen(credentialInfos, {
        theme: this.flags.theme || 'default',
      });
    } catch (error) {
      this.error(`Failed to list credentials: ${error}`);
    }
  }
}
