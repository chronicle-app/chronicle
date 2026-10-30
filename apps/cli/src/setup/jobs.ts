import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { targetArgs, type Target } from './targets.js';

/** A child's heap cap. Timing's extractor needed about 4 GB for a year. */
const HEAP_MB = 8192;

/**
 * How long a child has to end on Ctrl-C before it's killed. One reading a
 * database can't hear it until its query returns.
 */
const STOP_MS = 2000;

/** What ends setup without its exit running: closing the terminal, or `kill`. */
const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGHUP'];

/** One target's import, run as a child `chronicle import`. */
export interface Job {
  target: Target;
  /** Its record's name, without `.json`. */
  name: string;
  /** Its name in the list. */
  label: string;
  /** How many records its survey counted, when it could. */
  total: number | null;
  state: 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
  /** Records imported so far, as the child's progress says. */
  processed: number;
  startedAt?: number;
  endedAt?: number;
  /** Why it failed, as the child said. */
  error?: { message: string; hint?: string };
}

/** What a child says on stderr, as `--log-format json` writes it. */
export interface ChildEvent {
  level: string;
  kind: string;
  message: string;
  hint?: { action: string };
  fields?: Record<string, unknown>;
  error?: { code?: string; exitCode?: number };
}

export interface RunOptions {
  /** The folder each finished import's record goes in. */
  root: string;
  /** The store the children import into. */
  db: string;
  /** The CLI's `bin/run.js`, which the children run. */
  bin: string;
  /** The start of the year extracted, as `--since` takes it. */
  since: string;
  /** How many jobs run at once. */
  concurrency: number;
  /** A child's error or notice, to show under its source's name. */
  onEvent(job: Job, event: ChildEvent): void;
  /** A job started, finished, or failed. */
  onChange(job: Job): void;
}

/** What a finished import leaves: its target, and how it went. */
export interface Imported extends Target {
  since: string;
  records: number;
  /** The store it went into. */
  db: string;
  importedAt: string;
}

export const importedFile = (root: string, name: string) => path.join(root, `${name}.json`);

/** What a target's import left in `root`, when it went into the store at `db`. */
export function imported(root: string, name: string, db: string): Imported | undefined {
  try {
    const record = JSON.parse(readFileSync(importedFile(root, name), 'utf8')) as Imported;
    return record.db === db ? record : undefined;
  } catch {
    // Not imported yet.
    return undefined;
  }
}

/**
 * Runs jobs `concurrency` at a time, biggest first by their surveys' counts. Each
 * child imports its records into the store, saying how far it's got as it
 * goes; a record of the import goes in `root` when the child exits cleanly.
 * A job can join while others run, with `add()`. `stop()` ends the
 * children; what they imported stays, and the next run imports it again.
 * Each child has a temporary folder of its own, for its copies of the
 * databases it reads, deleted when it ends however it ends, killed too.
 * Should this process end while they run, they end with it, and leave no
 * copy.
 */
export class JobRunner {
  private readonly children = new Map<Job, ChildProcess>();
  /** Each running child's temporary folder. */
  private readonly scratches = new Map<Job, string>();
  private stopping = false;
  /** The jobs not started, biggest first. */
  private readonly queue: Job[] = [];
  /** How many jobs are running now. */
  private active = 0;
  /** Those waiting for every job to finish. */
  private waiters: (() => void)[] = [];

  constructor(
    readonly jobs: Job[],
    private readonly options: RunOptions
  ) {
    process.once('exit', this.clean);
    for (const signal of SIGNALS) process.once(signal, this.ended);
  }

  /** End every child still running, and delete its folder. */
  private clean = () => {
    for (const [job, child] of this.children) {
      child.kill('SIGKILL');
      const scratch = this.scratches.get(job);
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
    this.scratches.clear();
  };

  /** Ended by a signal: clean up, then end as the signal would have. */
  private ended = (signal: NodeJS.Signals) => {
    this.clean();
    process.removeListener('exit', this.clean);
    process.kill(process.pid, signal);
  };

  /** The command a job runs, after `chronicle`. */
  args(job: Job): string[] {
    return [
      'import',
      ...targetArgs(job.target),
      '--since',
      this.options.since,
      '--limit',
      '0',
      // Each record imported as it's read: not held until the end, and counted as it comes.
      '--stream',
      '--db',
      this.options.db,
      '--log-format',
      'json',
    ];
  }

  /** Run every job, and any added meanwhile, until they're finished. */
  run(): Promise<void> {
    this.queue.push(...this.jobs.filter(job => job.state === 'waiting'));
    this.pump();
    return this.drained();
  }

  /** Run another job, as soon as there's room. */
  add(job: Job): void {
    this.jobs.push(job);
    this.queue.push(job);
    this.pump();
  }

  /** Once no job is running or waiting to. */
  drained(): Promise<void> {
    if (this.active === 0 && (this.queue.length === 0 || this.stopping)) return Promise.resolve();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  /** Start jobs while there's room, biggest first, as the surveys counted them so far. */
  private pump(): void {
    this.queue.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
    while (!this.stopping && this.active < this.options.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      this.runOne(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
    if (this.active === 0 && (this.queue.length === 0 || this.stopping)) {
      const { waiters } = this;
      this.waiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  /** End every running child, and start no more. */
  async stop(): Promise<void> {
    this.stopping = true;
    const exits = [...this.children.values()].map(
      child =>
        new Promise<void>(resolve => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once('exit', () => resolve());
          child.kill('SIGINT');
          // One that can't hear the interrupt in time is ended outright.
          setTimeout(() => child.kill('SIGKILL'), STOP_MS).unref();
        })
    );
    await Promise.all(exits);
  }

  /** End every child at once, for a second Ctrl-C. */
  kill(): void {
    this.stopping = true;
    this.clean();
  }

  private runOne(job: Job): Promise<void> {
    const { root, bin, onEvent, onChange } = this.options;
    const scratch = mkdtempSync(path.join(tmpdir(), 'chronicle-job-'));
    this.scratches.set(job, scratch);
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${HEAP_MB}`, bin, ...this.args(job)],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        // Its copies go in its own folder, deleted with it.
        env: { ...process.env, CHRONICLE_SKIP_NEW_VERSION_CHECK: '1', TMPDIR: scratch },
      }
    );
    this.children.set(job, child);
    job.state = 'running';
    job.startedAt = Date.now();
    onChange(job);

    createInterface({ input: child.stderr! }).on('line', line => {
      let event: ChildEvent;
      try {
        event = JSON.parse(line);
      } catch {
        // Not an event, like a warning from Node itself.
        return;
      }
      // How far it's got, as it goes, and in all once it's through.
      if (event.kind === 'progress' && typeof event.fields?.processed === 'number') {
        job.processed = event.fields.processed;
      } else if (event.kind === 'summary' && typeof event.fields?.records === 'number') {
        job.processed = event.fields.records;
      }
      // Its error is why it failed, said once it has; anything else worth a
      // look shows as it comes.
      else if (event.kind === 'error') {
        job.error = { message: event.message, ...(event.hint && { hint: event.hint.action }) };
      } else if (event.level === 'warn' || event.level === 'error') {
        onEvent(job, event);
      }
    });

    return new Promise(resolve => {
      let finished = false;
      const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        this.children.delete(job);
        rmSync(scratch, { recursive: true, force: true });
        this.scratches.delete(job);
        job.endedAt = Date.now();
        // A child stopped by Ctrl-C exits 130, maybe before this process hears it.
        if (this.stopping || code === 130) {
          job.state = 'stopped';
        } else if (code === 0) {
          job.state = 'done';
          const record: Imported = {
            ...job.target,
            since: this.options.since,
            records: job.processed,
            db: this.options.db,
            importedAt: new Date(job.endedAt).toISOString(),
          };
          writeFileSync(importedFile(root, job.name), `${JSON.stringify(record, null, 2)}\n`);
        } else {
          job.state = 'failed';
          job.error ??= { message: `Exited with code ${code}` };
        }
        onChange(job);
        resolve();
      };
      child.once('error', error => {
        job.error = { message: error.message };
        finish(1);
      });
      // Once its stderr is read to the end, so its last error is in.
      child.once('close', code => finish(code));
    });
  }
}
