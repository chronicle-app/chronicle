export class BrowserLauncher {
  /**
   * Open a URL in the user's default browser
   */
  static async openUrl(url: string): Promise<void> {
    try {
      // Try to use the 'open' package if available
      const open = await import('open');
      await open.default(url);
    } catch {
      // Fallback to system commands
      await this.openUrlFallback(url);
    }
  }

  /**
   * Fallback method using system commands
   */
  private static async openUrlFallback(url: string): Promise<void> {
    const { spawn } = await import('node:child_process');
    const { platform } = process;

    let command: string;
    let args: string[];

    switch (platform) {
      case 'darwin': // macOS
        command = 'open';
        args = [url];
        break;
      case 'win32': // Windows
        command = 'cmd';
        args = ['/c', 'start', url];
        break;
      default: // Linux and others
        command = 'xdg-open';
        args = [url];
        break;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, args);

      child.on('error', error => {
        reject(new Error(`Failed to open browser: ${error.message}`));
      });

      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Browser command exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Check if we can open a browser on this system
   */
  static async canOpenBrowser(): Promise<boolean> {
    try {
      // Check if 'open' package is available
      await import('open');
      return true;
    } catch {
      // Check if system commands are available
      const { platform } = process;
      const { spawn } = await import('node:child_process');

      return new Promise(resolve => {
        let command: string;

        switch (platform) {
          case 'darwin':
            command = 'which';
            break;
          case 'win32':
            command = 'where';
            break;
          default:
            command = 'which';
            break;
        }

        const testCommand =
          platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
        const child = spawn(command, [testCommand]);

        child.on('close', code => {
          resolve(code === 0);
        });

        child.on('error', () => {
          resolve(false);
        });
      });
    }
  }
}
