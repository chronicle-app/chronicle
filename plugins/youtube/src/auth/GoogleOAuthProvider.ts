import { OAuthProvider } from '@chronicle.app/auth';

export class GoogleOAuthProvider extends OAuthProvider {
  static override providerId = 'youtube';
  static override authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth';

  static override tokenUrl = 'https://oauth2.googleapis.com/token';
  static override scopes: string[] = ['https://www.googleapis.com/auth/youtube.readonly'];

  static override requiresClientSecret = true;
  // Without offline access + forced consent Google issues no refresh token,
  // leaving the stored credential unable to outlive the first hour.
  static override extraAuthParams = {
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  };
}
