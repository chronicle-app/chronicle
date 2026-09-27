import { OAuthProvider } from '@chronicle.app/auth';

export class FoursquareOAuthProvider extends OAuthProvider {
  static override providerId = 'foursquare';
  static override authorizationUrl = 'https://foursquare.com/oauth2/authenticate';

  static override tokenUrl = 'https://foursquare.com/oauth2/access_token';
  static override scopes: string[] = [];
  static override requiresClientSecret = true;
}
