import { OAuthProvider } from '@chronicle.app/auth';

/**
 * X's OAuth 2.0 authorization-code flow. X requires PKCE for every client,
 * and a confidential client (a "Web App" in the X developer console) sends
 * its id and secret as a Basic header on the exchange and on refresh.
 *
 * The person registers their own app: X bills reads of your own posts,
 * likes, and bookmarks at its lower "owned read" rate only when the signed-in
 * account owns the app.
 */
export class TwitterOAuthProvider extends OAuthProvider {
  static override providerId = 'twitter';
  static override authorizationUrl = 'https://x.com/i/oauth2/authorize';
  static override tokenUrl = 'https://api.x.com/2/oauth2/token';
  static override scopes = [
    'tweet.read',
    'users.read',
    'like.read',
    'bookmark.read',
    // A refresh token, so a sign-in outlives the two-hour access token.
    'offline.access',
  ];

  static override pkce = true;
  static override tokenAuthStyle = 'basic-header' as const;
  static override signedInHint = 'Run `chronicle extract twitter --strategy api` to extract.';
}
