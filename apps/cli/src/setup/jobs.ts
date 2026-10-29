import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { targetArgs, type Target } from './targets.js';

/**
 * A child's heap cap. Timing's extractor needed about 4 GB for a year; a cap
 * isn't a reservation, so two jobs at a time can each have this much.
 */
const HEAP_MB = 8192;

/** How often a running job's file is counted. */
const COUNT_EVERY_MS = 250;

/**
 * How long a child has to end on Ctrl-C before it's killed. One reading a
 * database can't hear it until its query returns.
 */
const STOP_MS = 2000;

/** What ends setup without its exit running: closing the terminal, or `kill`. */
const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGHUP'];

/** One target's extraction, run as a child `chronicle extract`. */
export interface Job {
  target: Target;
  /** Its file's name, without `.jsonl`. */
  name: string;
  /** Its name in the list. */
  label: string;
  /** How many records its survey counted, when it could. */
  total: number | null;
  state: 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
  /** Records written so far: lines in its file. */
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
  /** The folder the files go in. */
  root: string;
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

export const partialFile = (root: string, name: string) => path.join(root, `${name}.jsonl.partial`);
export const finishedFile = (root: string, name: string) => path.join(root, `${name}.jsonl`);
export const targetFile = (root: string, name: string) => path.join(root, `${name}.target.json`);

/**
 * Counts the lines a child has written so far, reading only what's new
 * since it last looked.
 */
class LineCounter {
  private offset = 0;
  private readonly buffer = Buffer.alloc(1_048_576);
  lines = 0;

  constructor(private readonly file: string) {}

  update(): number {
    let fd: number;
    try {
      fd = openSync(this.file, 'r');
    } catch {
      return this.lines;
    }
    try {
      let read: number;
      while ((read = readSync(fd, this.buffer, 0, this.buffer.length, this.offset)) > 0) {
        for (let i = 0; i < read; i++) if (this.buffer[i] === 10) this.lines++;
        this.offset += read;
      }
    } finally {
      closeSync(fd);
    }
    return this.lines;
  }
}

/**
 * Runs jobs a few at a time, biggest first by their surveys' counts. Each
 * child writes its records to a `.partial` file, given to it as stdout, so
 * its writes never wait on this process; the file is renamed when the child
 * exits cleanly, with the target beside it. A job can join while others run,
 * with `add()`. `stop()` ends the children and deletes their partial files.
 * Each child has a temporary folder of its own, for its copies of the
 * databases it reads, deleted when it ends however it ends, killed too.
 * Should this process end while they run, they end with it, and leave
 * neither a partial file nor a copy.
 */
export class JobRunner {
  private readonly children = new Map<Job, ChildProcess>();
  /** Each running child's partial file and temporary folder. */
  private readonly files = new Map<Job, { partial: string; scratch: string }>();
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

  /** End every child still running, and delete its partial file and its folder. */
  private clean = () => {
    for (const [job, child] of this.children) {
      child.kill('SIGKILL');
      const files = this.files.get(job);
      if (files) {
        rmSync(files.partial, { force: true });
        rmSync(files.scratch, { recursive: true, force: true });
      }
    }
    this.files.clear();
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
      'extract',
      ...targetArgs(job.target),
      '--since',
      this.options.since,
      '--limit',
      '0',
      // Each record written as it's read: not held until the end, and counted as it comes.
      '--stream',
      '--loader',
      'jsonl',
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

  /** End every running child, delete its partial file, and start no more. */
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
    const partial = partialFile(root, job.name);
    const out = openSync(partial, 'w');
    const counter = new LineCounter(partial);
    const scratch = mkdtempSync(path.join(tmpdir(), 'chronicle-job-'));
    this.files.set(job, { partial, scratch });
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${HEAP_MB}`, bin, ...this.args(job)],
      {
        stdio: ['ignore', out, 'pipe'],
        // Its copies go in its own folder, deleted with it.
        env: { ...process.env, CHRONICLE_SKIP_NEW_VERSION_CHECK: '1', TMPDIR: scratch },
      }
    );
    closeSync(out);
    this.children.set(job, child);
    job.state = 'running';
    job.startedAt = Date.now();
    onChange(job);
    const ticker = setInterval(() => {
      job.processed = counter.update();
    }, COUNT_EVERY_MS);

    createInterface({ input: child.stderr! }).on('line', line => {
      let event: ChildEvent;
      try {
        event = JSON.parse(line);
      } catch {
        // Not an event, like a warning from Node itself.
        return;
      }
      // Its error is why it failed, said once it has; anything else worth a
      // look shows as it comes.
      if (event.kind === 'error') {
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
        clearInterval(ticker);
        this.children.delete(job);
        rmSync(scratch, { recursive: true, force: true });
        this.files.delete(job);
        job.processed = counter.update();
        job.endedAt = Date.now();
        // A child stopped by Ctrl-C exits 130, maybe before this process hears it.
        if (this.stopping || code === 130) {
          job.state = 'stopped';
          rmSync(partial, { force: true });
        } else if (code === 0) {
          job.state = 'done';
          renameSync(partial, finishedFile(root, job.name));
          writeFileSync(
            targetFile(root, job.name),
            `${JSON.stringify(
              {
                ...job.target,
                since: this.options.since,
                records: job.processed,
                extractedAt: new Date(job.endedAt).toISOString(),
              },
              null,
              2
            )}\n`
          );
        } else {
          job.state = 'failed';
          job.error ??= { message: `Exited with code ${code}` };
          rmSync(partial, { force: true });
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
