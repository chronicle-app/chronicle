import { OAuthProvider, type ProviderSetupContext } from '@chronicle.app/auth';
import { GOOGLE_SERVICES } from './services.js';
import { setupGoogleClient } from './setup.js';

/**
 * One Google sign-in for every Google source, with an OAuth client the person
 * registers in their own Google Cloud project: Chronicle ships no client.
 * Each account signed in is kept apart by its email.
 */
export class GoogleOAuthProvider extends OAuthProvider {
  static override providerId = 'google';
  static override authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  static override tokenUrl = 'https://oauth2.googleapis.com/token';
  // `openid email` brings back an id_token naming the account.
  static override scopes: string[] = ['openid', 'email'];
  static override scopeSets: Record<string, string[]> = Object.fromEntries(
    Object.entries(GOOGLE_SERVICES).map(([name, service]) => [name, [...service.scopes]])
  );

  static override defaultScopeSets = ['gmail', 'calendar'];
  static override requiresClientSecret = true;
  static override pkce = true;
  // Without offline access + forced consent Google issues no refresh token,
  // leaving the stored credential unable to outlive the first hour.
  // include_granted_scopes keeps what was granted before when access is added.
  static override extraAuthParams = {
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  };

  static override signedInHint = [
    'Run `chronicle extract google-calendar` to extract your calendar.',
    'Run `chronicle extract gmail` to extract your mail.',
  ].join('\n');

  static override setup(context: ProviderSetupContext) {
    return setupGoogleClient(context);
  }

  /** The email in the id_token, which came straight from Google's token endpoint. */
  protected override accountFrom(response: any): string | undefined {
    const payload = response?.id_token?.split('.')[1];
    if (!payload) return undefined;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      return typeof claims.email === 'string' ? claims.email : undefined;
    } catch {
      return undefined;
    }
  }
}
