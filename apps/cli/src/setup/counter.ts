import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Survey } from '@chronicle.app/etl';
import type { ScanRow } from '../plugins/scan.js';
import type { Ask } from './countWorker.js';
import type { Target } from './targets.js';

type Answer = { id: number; answer: unknown } | { id: number; error: string };

/** What ends setup without its exit running: closing the terminal, or `kill`. */
const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGHUP'];

/**
 * Counts what rows hold and what targets would extract, in a process of its
 * own, so a survey that reads all it counts without stopping never holds up
 * what's drawn or the keys pressed. A worker thread couldn't be stopped
 * partway through a query, and would keep setup from ending until it
 * returned; a process is killed at once. It loads the plugins itself, once
 * it starts, and again on `refresh()`. It keeps its copies of databases in a
 * folder of its own, so it can be stopped at any time and leave none.
 */
export class Counter {
  private child?: ChildProcess;
  /** The counter's temporary folder, deleted with it. */
  private folder?: string;
  private next = 0;
  private readonly waiting = new Map<number, (answer: Answer) => void>();

  /** What a row holds, by its survey: null when it can't say. */
  row(row: ScanRow): Promise<Survey | null> {
    return this.ask(id => ({ id, row })) as Promise<Survey | null>;
  }

  /** How many records a target's run from `since` would extract: null when it can't say. */
  target(target: Target, since: Date): Promise<number | null> {
    return this.ask(id => ({ id, target, since: since.toISOString() })) as Promise<number | null>;
  }

  /** Load the plugins again, after one's installed. */
  refresh(): void {
    if (this.child?.connected) this.child.send({ refresh: true } satisfies Ask);
  }

  /** Stop counting, at once: any count not in yet fails, and the counter's copies are deleted. */
  close(): void {
    this.fail('Counting stopped');
    this.clean();
  }

  /** Answer each count not in yet with why it won't be. */
  private fail(error: string): void {
    for (const [id, answer] of this.waiting) answer({ id, error });
    this.waiting.clear();
  }

  /**
   * End the counter, and delete its folder and its copies. On exit too, or
   * when setup is ended by a signal, should it end without closing.
   */
  private clean = () => {
    this.child?.kill('SIGKILL');
    this.child = undefined;
    if (this.folder) rmSync(this.folder, { recursive: true, force: true });
    this.folder = undefined;
    process.removeListener('exit', this.clean);
    for (const signal of SIGNALS) process.removeListener(signal, this.ended);
  };

  /** Ended by a signal: clean up, then end as the signal would have. */
  private ended = (signal: NodeJS.Signals) => {
    this.clean();
    process.kill(process.pid, signal);
  };

  private start(): ChildProcess {
    this.folder = mkdtempSync(path.join(tmpdir(), 'chronicle-counts-'));
    process.once('exit', this.clean);
    for (const signal of SIGNALS) process.once(signal, this.ended);
    const child = fork(fileURLToPath(new URL('countWorker.js', import.meta.url)), [], {
      // Its copies go where they're deleted with it.
      env: { ...process.env, TMPDIR: this.folder },
      // What a plugin logs while it counts would print over the screen.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // Counting never keeps setup open.
    child.unref();
    child.channel?.unref();
    child.on('message', (answer: Answer) => {
      this.waiting.get(answer.id)?.(answer);
      this.waiting.delete(answer.id);
    });
    // A counter that fails or ends answers each count it had with why.
    child.on('error', error => this.fail(String(error)));
    child.on('exit', () => {
      this.fail('Counting stopped');
      if (this.child === child) this.child = undefined;
    });
    return child;
  }

  private ask(make: (id: number) => Ask): Promise<unknown> {
    const child = this.child?.connected ? this.child : this.start();
    this.child = child;
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, answer =>
        'error' in answer ? reject(new Error(answer.error)) : resolve(answer.answer)
      );
      child.send(make(id));
    });
  }
}
