import { execSync } from 'node:child_process';
import { hostname } from 'node:os';
import { SystemInfo } from '../SystemInfo.js';
import { createLogger } from '@chronicle.app/logging';

/**
 * Linux-specific implementation of SystemInfo
 * Uses standard Unix commands and /etc/passwd
 */
export class LinuxSystemInfo extends SystemInfo {
  private _realName?: string;
  private logger = createLogger({ prefix: '[LinuxSystemInfo]' });

  async getRealName(): Promise<string> {
    if (this._realName) {
      return this._realName;
    }

    try {
      // Try to get real name from passwd GECOS field
      const passwd = execSync(`getent passwd ${this.getUsername()}`, {
        encoding: 'utf8',
        timeout: 5000,
      });

      // Parse passwd format: "username:x:uid:gid:Full Name,,,,:home:shell"
      const parts = passwd.split(':');
      if (parts.length >= 5 && parts[4]) {
        // GECOS field may contain comma-separated values, take first part
        const gecosName = parts[4].split(',')[0].trim();
        if (gecosName) {
          this._realName = gecosName;
          return this._realName;
        }
      }
    } catch {
      this.logger.warn('Could not retrieve real name from passwd, falling back to username');
    }

    // Fallback to username
    this._realName = this.getUsername();
    return this._realName;
  }

  getHostname(): string {
    return hostname();
  }

  getUsername(): string {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }

  async getPlatformIdentifier(): Promise<string> {
    try {
      // Try to get machine-id (systemd systems)
      const machineId = execSync('cat /etc/machine-id', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      return `linux-${machineId}-${this.getUsername()}`;
    } catch {
      // Fallback: hostname + username
      return `linux-${this.getHostname().replaceAll('.', '-')}-${this.getUsername()}`;
    }
  }
}
