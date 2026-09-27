import { OAuthProvider } from '@chronicle.app/auth';

export class SpotifyOAuthProvider extends OAuthProvider {
  static override providerId = 'spotify';
  static override authorizationUrl = 'https://accounts.spotify.com/authorize';
  static override tokenUrl = 'https://accounts.spotify.com/api/token';
  static override scopes: string[] = [
    'user-read-recently-played',
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-top-read',
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
  ];

  static override requiresClientSecret = true;
  static override tokenAuthStyle = 'basic-header' as const;
}
