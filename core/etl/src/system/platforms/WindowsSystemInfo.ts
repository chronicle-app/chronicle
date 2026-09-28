import { execSync } from 'node:child_process';
import { hostname } from 'node:os';
import { SystemInfo } from '../SystemInfo.js';
import { createLogger } from '@chronicle.app/logging';

/**
 * Windows-specific implementation of SystemInfo
 * Uses Windows Management Instrumentation (wmic) and environment variables
 */
export class WindowsSystemInfo extends SystemInfo {
  private _realName?: string;
  private logger = createLogger({ prefix: '[WindowsSystemInfo]' });

  async getRealName(): Promise<string> {
    if (this._realName) {
      return this._realName;
    }

    try {
      // Try to get full name from Windows user account
      const output = execSync('wmic useraccount where name="%USERNAME%" get fullname /value', {
        encoding: 'utf8',
        timeout: 10_000,
      });

      const match = output.match(/FullName=(.+)/);
      if (match && match[1] && match[1].trim()) {
        this._realName = match[1].trim();
        return this._realName;
      }
    } catch {
      this.logger.warn('Could not retrieve full name from Windows, falling back to username');
    }

    // Fallback to username
    this._realName = this.getUsername();
    return this._realName;
  }

  getHostname(): string {
    return hostname();
  }

  getUsername(): string {
    return process.env.USERNAME || process.env.USER || 'unknown';
  }

  async getPlatformIdentifier(): Promise<string> {
    try {
      // Get Windows machine GUID
      const output = execSync('wmic csproduct get uuid /value', {
        encoding: 'utf8',
        timeout: 10_000,
      });

      const match = output.match(/UUID=([A-F0-9-]+)/i);
      if (match && match[1]) {
        return `windows-${match[1]}-${this.getUsername()}`;
      }
    } catch (error) {
      this.logger.warn(`Could not retrieve Windows UUID: ${error}`);
    }

    // Fallback: hostname + username
    return `windows-${this.getHostname().replaceAll('.', '-')}-${this.getUsername()}`;
  }
}
