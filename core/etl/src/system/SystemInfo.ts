/**
 * Abstract base class for system information providers
 * Provides cross-platform access to user identity and system details
 */
export abstract class SystemInfo {
  /**
   * Factory method to get the appropriate SystemInfo implementation for the current platform
   */
  static async getInstance(): Promise<SystemInfo> {
    switch (process.platform) {
      case 'darwin': {
        const { MacOSSystemInfo } = await import('./platforms/MacOSSystemInfo.js');
        return new MacOSSystemInfo();
      }
      case 'linux': {
        const { LinuxSystemInfo } = await import('./platforms/LinuxSystemInfo.js');
        return new LinuxSystemInfo();
      }
      case 'win32': {
        const { WindowsSystemInfo } = await import('./platforms/WindowsSystemInfo.js');
        return new WindowsSystemInfo();
      }
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  /**
   * Get the user's display name (e.g., "Pat Example")
   * This should be the human-readable name, not the username
   */
  abstract getRealName(): Promise<string>;

  /**
   * Get the system hostname (may be an env-dependent FQDN)
   */
  abstract getHostname(): string;

  /**
   * The stable short machine name for this system — see {@link normalizeMachineName}.
   */
  getMachineName(): string {
    return SystemInfo.normalizeMachineName(this.getHostname());
  }

  /**
   * Normalize a raw machine name to its stable short form: the first label,
   * lowercased. A raw name can be an env-dependent FQDN (Tailscale
   * `pat-mbp.tail….ts.net`, Bonjour `pat-mbp.local`, or bare `pat-mbp`) or a
   * source's device name; reducing to the first label keeps a machine's identity stable as that
   * suffix changes and lets different sources key on the same value. Centralized
   * here so no caller re-derives it (e.g. shell's hostname and Timing's device
   * name both flow through this, so they resolve to one realm).
   */
  static normalizeMachineName(raw: string): string {
    return raw.trim().split('.')[0].toLowerCase();
  }

  /**
   * Get the system username (e.g., "pat")
   */
  abstract getUsername(): string;

  /**
   * Get a stable platform-specific identifier for this user/system combination
   * Should be consistent across app installations but unique per user
   */
  abstract getPlatformIdentifier(): Promise<string>;

  /**
   * Generate a stable agent ID suitable for cross-device deduplication
   * Format: "source-realname-platformhint"
   * Example: "things-pat-example-macos"
   */
  async generateAgentId(source: string): Promise<string> {
    const realName = await this.getRealName();
    const platform = process.platform === 'darwin' ? 'macos' : process.platform;

    // Normalize the name for use in ID
    const normalizedName = realName
      .toLowerCase()
      .replaceAll(/\s+/g, '-')
      .replaceAll(/[^a-z0-9-]/g, '');

    return `${source}-${normalizedName}-${platform}`;
  }

  /**
   * Get comprehensive agent information
   */
  async getAgentInfo(): Promise<{
    id: string;
    realName: string;
    username: string;
    hostname: string;
    platform: string;
    platformIdentifier: string;
  }> {
    const [realName, platformIdentifier] = await Promise.all([
      this.getRealName(),
      this.getPlatformIdentifier(),
    ]);

    return {
      id: await this.generateAgentId('chronicle'),
      realName,
      username: this.getUsername(),
      hostname: this.getHostname(),
      platform: process.platform,
      platformIdentifier,
    };
  }
}
