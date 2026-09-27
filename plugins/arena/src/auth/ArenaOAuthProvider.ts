import { OAuthProvider } from '@chronicle.app/auth';

export class ArenaOAuthProvider extends OAuthProvider {
  static override providerId = 'arena';
  static override authorizationUrl = 'https://www.are.na/oauth/authorize';
  static override tokenUrl = 'https://api.are.na/v3/oauth/token';
  static override scopes = ['read'];
  static override requiresClientSecret = true;
}
