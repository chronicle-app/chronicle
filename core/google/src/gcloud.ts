import { spawn } from 'node:child_process';

/** What setup needs from Google Cloud's command line. */
export interface Gcloud {
  /** Whether `gcloud` is installed. */
  available(): Promise<boolean>;
  /** The signed-in account, if any. */
  account(): Promise<string | undefined>;
  /** Sign in; gcloud opens the browser and talks to the terminal itself. */
  login(): Promise<void>;
  createProject(projectId: string, name: string): Promise<void>;
  /** IDs of the projects the signed-in account can see. */
  listProjects(): Promise<string[]>;
  enableApis(projectId: string, apis: string[]): Promise<void>;
}

/** A gcloud command that failed, with what it said. */
export class GcloudError extends Error {
  /** gcloud's error, unwrapped into one line, without its `ERROR: (gcloud.…)` prefix. */
  readonly said: string;

  constructor(
    readonly args: string[],
    readonly stderr: string
  ) {
    const said = gcloudSaid(stderr);
    super(`gcloud ${args.slice(0, 2).join(' ')} failed: ${said}`);
    this.name = 'GcloudError';
    this.said = said;
  }
}

/**
 * The error in gcloud's output: from its `ERROR:` line to the next blank
 * line, which gcloud wraps at 80 columns, as one line. Anything else it
 * printed (update notices) is left out.
 */
export function gcloudSaid(stderr: string): string {
  const lines = stderr.split('\n');
  const start = lines.findIndex(line => line.startsWith('ERROR:'));
  const from = start === -1 ? lines.filter(line => line.trim()).slice(-1) : lines.slice(start);
  const end = from.findIndex(line => !line.trim());
  return (
    (end === -1 ? from : from.slice(0, end))
      .map(line => line.trim())
      .join(' ')
      .replace(/^ERROR:\s*(\(gcloud[^)]*\)\s*)?/, '')
      .trim() || 'no output'
  );
}

/**
 * gcloud with its own config directory (`CLOUDSDK_CONFIG`), so the account
 * and project Chronicle sets up never touch a person's everyday gcloud: its
 * accounts, active project, and application default credentials stay as
 * they were. Commands run with argument arrays, never through a shell.
 */
export class CommandLineGcloud implements Gcloud {
  constructor(
    private readonly configDir: string,
    private readonly bin = 'gcloud'
  ) {}

  async available(): Promise<boolean> {
    try {
      await this.run(['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async account(): Promise<string | undefined> {
    // A gcloud that can't list accounts has none we can use.
    const out = await this.run([
      'auth',
      'list',
      '--filter=status:ACTIVE',
      '--format=value(account)',
    ]).catch(() => '');
    return out.trim().split('\n')[0] || undefined;
  }

  async login(): Promise<void> {
    await this.run(['auth', 'login', '--brief'], { interactive: true });
  }

  async createProject(projectId: string, name: string): Promise<void> {
    await this.run(['projects', 'create', projectId, `--name=${name}`]);
  }

  async listProjects(): Promise<string[]> {
    const out = await this.run(['projects', 'list', '--format=value(projectId)']);
    return out.split('\n').filter(Boolean);
  }

  async enableApis(projectId: string, apis: string[]): Promise<void> {
    await this.run(['services', 'enable', ...apis, `--project=${projectId}`]);
  }

  private run(args: string[], { interactive = false } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        env: {
          ...process.env,
          CLOUDSDK_CONFIG: this.configDir,
          // No "updates are available" notice in the middle of setup.
          CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: '1',
          // Fail instead of stopping at a question nobody sees.
          ...(!interactive && { CLOUDSDK_CORE_DISABLE_PROMPTS: '1' }),
        },
        stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr?.on('data', chunk => {
        stderr += chunk;
      });
      child.on('error', error => reject(error));
      child.on('close', code =>
        code === 0 ? resolve(stdout) : reject(new GcloudError(args, stderr))
      );
    });
  }
}
