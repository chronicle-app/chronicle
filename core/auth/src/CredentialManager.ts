import { chronicleConfigDir } from './configDir.js';
import { FileCredentialManager } from './FileCredentialManager.js';
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
}

export class CredentialManager {
  private static fileManager: FileCredentialManager | null = null;

  private static getFileManager(): FileCredentialManager {
    if (!this.fileManager) {
      // The same config directory oclif resolves, so the file matches what
      // `chronicle auth set` writes from inside a command.
      this.fileManager = new FileCredentialManager(chronicleConfigDir());
    }
    return this.fileManager;
  }

  /**
   * Store OAuth credentials in local file
   */
  static async storeCredentials(
    provider: string,
    credentials: TokenResponse,
    clientId?: string,
    clientSecret?: string
  ): Promise<void> {
    const fileManager = this.getFileManager();
    await fileManager.storeCredentials(provider, credentials, clientId, clientSecret);
  }

  /**
   * Retrieve stored credentials from file
   */
  static async getCredentials(provider: string): Promise<StoredCredentials | null> {
    const fileManager = this.getFileManager();
    return fileManager.getCredentials(provider);
  }

  /**
   * Remove credentials from file
   */
  static async removeCredentials(provider: string): Promise<void> {
    const fileManager = this.getFileManager();
    await fileManager.removeCredentials(provider);
  }

  /**
   * Check if stored access token is expired
   */
  static isTokenExpired(credentials: StoredCredentials): boolean {
    const fileManager = this.getFileManager();
    return fileManager.isTokenExpired(credentials);
  }

  /**
   * Get valid access token, checking expiration
   */
  static async getValidToken(provider: string): Promise<string | null> {
    const fileManager = this.getFileManager();
    return fileManager.getValidToken(provider);
  }

  /**
   * List all stored provider credentials
   */
  static async listProviders(): Promise<string[]> {
    const fileManager = this.getFileManager();
    return fileManager.listProviders();
  }

  /**
   * Check if credentials exist for a provider
   */
  static async hasCredentials(provider: string): Promise<boolean> {
    const fileManager = this.getFileManager();
    return fileManager.hasCredentials(provider);
  }

  /**
   * Get the path where credentials are stored (for user reference)
   */
  static getCredentialsPath(): string {
    const fileManager = this.getFileManager();
    return fileManager.getCredentialsPath();
  }
}
