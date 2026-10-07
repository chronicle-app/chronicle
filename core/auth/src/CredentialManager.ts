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
  /** Which account signed in, for a provider with several. */
  account?: string;
  /** Where the refresh token is exchanged. */
  tokenUrl?: string;
}

export class CredentialManager {
  private static fileManager: FileCredentialManager | null = null;
  private static fileManagerDir: string | null = null;

  private static getFileManager(): FileCredentialManager {
    // The same config directory oclif resolves, so the file matches what
    // `chronicle auth set` writes from inside a command. Looked up each time,
    // so a change to CHRONICLE_CONFIG_DIR (a test's own directory) is seen.
    const dir = chronicleConfigDir();
    if (!this.fileManager || this.fileManagerDir !== dir) {
      this.fileManager = new FileCredentialManager(dir);
      this.fileManagerDir = dir;
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
   * Retrieve stored credentials from file: the given account's, or the most
   * recent sign-in
   */
  static async getCredentials(
    provider: string,
    options: { account?: string } = {}
  ): Promise<StoredCredentials | null> {
    const fileManager = this.getFileManager();
    return fileManager.getCredentials(provider, options);
  }

  /**
   * Every account's stored credentials for a provider
   */
  static async getAllCredentials(provider: string): Promise<StoredCredentials[]> {
    const fileManager = this.getFileManager();
    return fileManager.getAllCredentials(provider);
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
  static async getValidToken(
    provider: string,
    options: { account?: string; refresh?: boolean } = {}
  ): Promise<string | null> {
    const fileManager = this.getFileManager();
    return fileManager.getValidToken(provider, options);
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
