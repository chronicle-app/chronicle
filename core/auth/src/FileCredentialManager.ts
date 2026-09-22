import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { TokenResponse } from './types.js';

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
  createdAt: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  [key: string]: any; // Allow additional fields from TokenResponse
}

interface CredentialsFile {
  [provider: string]: StoredCredentials[];
}

export class FileCredentialManager {
  private credentialsPath: string;

  constructor(configDir: string) {
    this.credentialsPath = join(configDir, 'credentials.json');
  }

  /**
   * Load all credentials from file
   */
  private async loadCredentials(): Promise<CredentialsFile> {
    try {
      const credentialsText = await fs.readFile(this.credentialsPath, 'utf-8');
      const parsed = JSON.parse(credentialsText);

      // Migrate old format to new array format
      return this.migrateCredentialsFormat(parsed);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Credentials file doesn't exist, return empty
        return {};
      }
      // If file is invalid, return empty and log warning
      console.warn('Invalid credentials file, starting fresh:', error);
      return {};
    }
  }

  /**
   * Migrate old credential format (single objects) to new format (arrays)
   */
  private migrateCredentialsFormat(credentials: any): CredentialsFile {
    const migrated: CredentialsFile = {};

    for (const [provider, creds] of Object.entries(credentials)) {
      if (Array.isArray(creds)) {
        // Already in new format
        migrated[provider] = creds as StoredCredentials[];
      } else {
        // Old format - convert to array
        migrated[provider] = [creds as StoredCredentials];
      }
    }

    return migrated;
  }

  /**
   * Save all credentials to file
   */
  private async saveCredentials(credentials: CredentialsFile): Promise<void> {
    // Ensure config directory exists
    await fs.mkdir(dirname(this.credentialsPath), { recursive: true });

    // Write credentials file with proper formatting and permissions
    await fs.writeFile(
      this.credentialsPath,
      JSON.stringify(credentials, null, 2),
      { mode: 0o600 } // Restrict to user read/write only
    );
  }

  /**
   * Store OAuth credentials for a provider
   */
  async storeCredentials(
    provider: string,
    tokenResponse: TokenResponse,
    clientId?: string,
    clientSecret?: string
  ): Promise<void> {
    const credentials = await this.loadCredentials();

    // Initialize provider array if it doesn't exist
    if (!credentials[provider]) {
      credentials[provider] = [];
    }

    const newCredential: StoredCredentials = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type,
      expiresIn: tokenResponse.expires_in,
      scope: tokenResponse.scope,
      createdAt: tokenResponse.created_at,
      clientId,
      clientSecret,
      // Include any additional fields from the token response
      ...Object.fromEntries(
        Object.entries(tokenResponse).filter(
          ([key]) =>
            ![
              'access_token',
              'refresh_token',
              'token_type',
              'expires_in',
              'scope',
              'created_at',
              'provider',
            ].includes(key)
        )
      ),
    };

    // Add new credential to the array
    credentials[provider].push(newCredential);

    await this.saveCredentials(credentials);
  }

  /**
   * Update stored credentials directly (used for token refresh)
   */
  private async updateStoredCredentials(
    provider: string,
    updatedCredentials: StoredCredentials
  ): Promise<void> {
    const credentials = await this.loadCredentials();
    if (!credentials[provider] || credentials[provider].length === 0) {
      credentials[provider] = [updatedCredentials];
    } else {
      credentials[provider][0] = updatedCredentials;
    }
    await this.saveCredentials(credentials);
  }

  /**
   * Retrieve stored credentials for a provider (returns most recent credential)
   */
  async getCredentials(provider: string): Promise<StoredCredentials | null> {
    const credentials = await this.loadCredentials();
    const providerCredentials = credentials[provider];
    return providerCredentials && providerCredentials.length > 0
      ? (providerCredentials.at(-1) ?? null)
      : null;
  }

  /**
   * Retrieve all stored credentials for a provider
   */
  async getAllCredentials(provider: string): Promise<StoredCredentials[]> {
    const credentials = await this.loadCredentials();
    return credentials[provider] || [];
  }

  /**
   * Remove credentials for a provider
   */
  async removeCredentials(provider: string): Promise<void> {
    const credentials = await this.loadCredentials();
    delete credentials[provider];
    await this.saveCredentials(credentials);
  }

  /**
   * Check if stored access token is expired
   */
  isTokenExpired(credentials: StoredCredentials): boolean {
    if (!credentials.expiresIn) {
      return false; // No expiration info, assume valid
    }

    const createdAt = new Date(credentials.createdAt).getTime();
    const expiresAt = createdAt + credentials.expiresIn * 1000;
    const now = Date.now();

    // Consider expired if less than 5 minutes remaining
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    return now >= expiresAt - bufferTime;
  }

  /**
   * Get valid access token, checking expiration
   */
  async getValidToken(provider: string): Promise<string | null> {
    const credentials = await this.getCredentials(provider);
    if (!credentials) {
      return null;
    }

    // If token is not expired, return it
    if (!this.isTokenExpired(credentials)) {
      return credentials.accessToken;
    }

    // Token is expired - try to refresh if we have refresh token and client secret
    if (credentials.refreshToken && credentials.clientId && credentials.clientSecret) {
      try {
        const refreshedToken = await this.refreshToken(provider, credentials);
        if (refreshedToken) {
          return refreshedToken;
        }
      } catch (error) {
        console.warn(
          `Failed to refresh ${provider} token:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    return null;
  }

  /**
   * Refresh an expired token using the refresh token
   */
  private async refreshToken(
    provider: string,
    credentials: StoredCredentials
  ): Promise<string | null> {
    if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
      return null;
    }

    const refreshUrl = this.getRefreshUrl(provider);
    if (!refreshUrl) {
      return null;
    }

    try {
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const tokenData = (await response.json()) as TokenResponse;

      // Update stored credentials with new token
      const updatedCredentials: StoredCredentials = {
        ...credentials,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || credentials.refreshToken,
        expiresIn: tokenData.expires_in,
        createdAt: new Date().toISOString(),
      };

      await this.updateStoredCredentials(provider, updatedCredentials);
      return tokenData.access_token;
    } catch (error) {
      throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get the token refresh URL for a specific provider
   */
  private getRefreshUrl(provider: string): string | null {
    const refreshUrls: Record<string, string> = {
      spotify: 'https://accounts.spotify.com/api/token',
      // Google's token endpoint accepts client_secret_basic, so the shared
      // Basic-auth refresh above works for it.
      youtube: 'https://oauth2.googleapis.com/token',
    };

    return refreshUrls[provider] || null;
  }

  /**
   * List all providers with stored credentials
   */
  async listProviders(): Promise<string[]> {
    const credentials = await this.loadCredentials();
    return Object.keys(credentials);
  }

  /**
   * Check if credentials exist for a provider
   */
  async hasCredentials(provider: string): Promise<boolean> {
    const credentials = await this.getCredentials(provider);
    return credentials !== null;
  }

  /**
   * Get the path where credentials are stored (for user reference)
   */
  getCredentialsPath(): string {
    return this.credentialsPath;
  }
}
