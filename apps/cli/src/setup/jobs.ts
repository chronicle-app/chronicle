import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
 * exits cleanly, with the target beside it. `stop()` ends the children and
 * deletes their partial files.
 */
export class JobRunner {
  private readonly children = new Map<Job, ChildProcess>();
  private stopping = false;

  constructor(
    readonly jobs: Job[],
    private readonly options: RunOptions
  ) {}

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

  async run(): Promise<void> {
    const queue = [...this.jobs].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
    const next = async (): Promise<void> => {
      const job = queue.shift();
      if (!job || this.stopping) return;
      await this.runOne(job);
      return next();
    };
    await Promise.all(Array.from({ length: this.options.concurrency }, () => next()));
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
          // One that ignores the interrupt is ended outright.
          setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        })
    );
    await Promise.all(exits);
  }

  private runOne(job: Job): Promise<void> {
    const { root, bin, onEvent, onChange } = this.options;
    const partial = partialFile(root, job.name);
    const out = openSync(partial, 'w');
    const counter = new LineCounter(partial);
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${HEAP_MB}`, bin, ...this.args(job)],
      {
        stdio: ['ignore', out, 'pipe'],
        env: { ...process.env, CHRONICLE_SKIP_NEW_VERSION_CHECK: '1' },
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
