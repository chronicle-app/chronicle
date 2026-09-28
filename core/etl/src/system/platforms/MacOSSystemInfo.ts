import { execSync } from 'node:child_process';
import { hostname } from 'node:os';
import { SystemInfo } from '../SystemInfo.js';
import { createLogger } from '@chronicle.app/logging';

/**
 * macOS-specific implementation of SystemInfo
 * Uses macOS Directory Services (dscl) and system commands
 */
export class MacOSSystemInfo extends SystemInfo {
  private _realName?: string;
  private _hardwareUUID?: string;
  private logger = createLogger({ prefix: '[MacOSSystemInfo]' });

  /**
   * Get the user's real name using macOS Directory Services
   */
  async getRealName(): Promise<string> {
    if (this._realName) {
      return this._realName;
    }

    try {
      // Primary method: Use Directory Services
      const dscl = execSync(`dscl . -read /Users/${this.getUsername()} RealName`, {
        encoding: 'utf8',
        timeout: 5000,
      });

      // Parse the dscl output: "RealName:\n Pat Example"
      const match = dscl.match(/RealName:\s*\n?\s*(.+)/);
      if (match && match[1]) {
        this._realName = match[1].trim();
        return this._realName;
      }
    } catch {
      // Fallback: try parsing from passwd database
      try {
        const passwd = execSync(`id -P ${this.getUsername()}`, {
          encoding: 'utf8',
          timeout: 5000,
        });

        // Parse passwd format: "username:*:uid:gid::0:0:Full Name:home:shell"
        const parts = passwd.split(':');
        if (parts.length >= 8 && parts[7]) {
          this._realName = parts[7].trim();
          return this._realName;
        }
      } catch {
        // Last resort: return username
        this.logger.warn('Could not retrieve real name, falling back to username');
        this._realName = this.getUsername();
        return this._realName;
      }
    }

    // If all else fails, return username
    this._realName = this.getUsername();
    return this._realName;
  }

  /**
   * Get system hostname
   */
  getHostname(): string {
    return hostname();
  }

  /**
   * Get current username
   */
  getUsername(): string {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }

  /**
   * Get macOS hardware UUID for stable system identification
   */
  private async getHardwareUUID(): Promise<string> {
    if (this._hardwareUUID) {
      return this._hardwareUUID;
    }

    try {
      const output = execSync('system_profiler SPHardwareDataType | grep "Hardware UUID"', {
        encoding: 'utf8',
        timeout: 10_000,
      });

      const match = output.match(/Hardware UUID:\s*([A-F0-9-]+)/);
      if (match && match[1]) {
        this._hardwareUUID = match[1];
        return this._hardwareUUID;
      }
    } catch (error) {
      this.logger.warn(`Could not retrieve hardware UUID: ${error}`);
    }

    // Fallback: use hostname + username combo
    this._hardwareUUID = `${this.getHostname().replaceAll('.', '-')}-${this.getUsername()}`;
    return this._hardwareUUID;
  }

  /**
   * Get stable platform identifier combining user and system info
   */
  async getPlatformIdentifier(): Promise<string> {
    const hardwareUUID = await this.getHardwareUUID();
    const username = this.getUsername();

    // Create a stable identifier: hardware-user combination
    return `macos-${hardwareUUID}-${username}`;
  }
}
