import {
  clock,
  count,
  glyphs,
  hint,
  line,
  truncatePath,
  type Segment,
  type Tokens,
} from '../output/index.js';
import type { Job } from './jobs.js';

/** A job's bar, as wide as this. The overall bar ends where a job's does. */
const BAR = 22;

/** `filled` of `width`, the done part in the accent color. */
function bar(done: number, total: number, width: number, t: Tokens): Segment[] {
  const filled = total > 0 ? Math.round(Math.min(1, done / total) * width) : 0;
  return [
    [glyphs.bar.repeat(filled), t.accent],
    [glyphs.rule.repeat(width - filled), t.muted],
  ];
}

const rate = (job: Job, now: number) => {
  const seconds = (now - (job.startedAt ?? now)) / 1000;
  return seconds >= 1 ? `${count(Math.round(job.processed / seconds))}/s` : '';
};

/** Time left, the way a person says it: `about 3 min left`. */
function left(seconds: number): string {
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  return `about ${Math.round(minutes / 60)} h left`;
}

/**
 * The live area while jobs run: a line for each running job, with a bar
 * where its survey counted; the jobs still waiting; and the whole run, with
 * the time left.
 *
 *   ⠼ imessage  ━━━━━━━━━━━━──────────  24,190/52,111  1,912/s
 *     Waiting: gmail
 *     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  39,807/73,628  about 1 min left  0:41
 */
export function liveLines(
  jobs: Job[],
  startedAt: number,
  t: Tokens,
  width: number,
  frame: number
): string[] {
  const now = Date.now();
  const names = Math.max(...jobs.map(job => job.label.length));
  const spinner = glyphs.spinner[frame % glyphs.spinner.length];
  const amounts = (job: Job) =>
    job.total === null
      ? `${count(job.processed)} extracted`
      : `${count(job.processed)}/${count(job.total)}`;
  const running = jobs.filter(job => job.state === 'running');
  const amountWidth = Math.max(0, ...running.map(job => amounts(job).length));
  const lines = running.map(job =>
    line(
      [
        [spinner, t.accent],
        [` ${job.label.padEnd(names)}  `, t.strong],
        ...(job.total === null
          ? [[' '.repeat(BAR)] as Segment]
          : bar(job.processed, job.total, BAR, t)),
        [`  ${amounts(job).padStart(amountWidth)}`],
        [`  ${rate(job, now)}`, t.muted],
      ],
      width
    )
  );
  const waiting = jobs.filter(job => job.state === 'waiting');
  if (waiting.length > 0) {
    lines.push(line([[`  Waiting: ${waiting.map(job => job.label).join(', ')}`, t.muted]], width));
  }
  // The whole run, counted against what the surveys counted.
  const counted = jobs.filter(job => job.total !== null);
  const total = counted.reduce((n, job) => n + job.total!, 0);
  const done = counted.reduce((n, job) => n + Math.min(job.processed, job.total!), 0);
  const elapsed = now - startedAt;
  const tail: Segment[] = [];
  if (total > 0) {
    tail.push([`  ${count(done)}/${count(total)}`]);
    // Five seconds in, the rate so far says how long the rest takes.
    if (done > 0 && elapsed >= 5000 && done < total) {
      tail.push([`  ${left(((total - done) / done) * (elapsed / 1000))}`, t.muted]);
    }
  } else {
    const all = jobs.reduce((n, job) => n + job.processed, 0);
    tail.push([`${count(all)} extracted`]);
  }
  tail.push([`  ${clock(elapsed)}`, t.muted]);
  // The bar ends where a job's does, or sooner, so what follows it fits.
  const room = width - 2 - tail.reduce((n, [text]) => n + text.length, 0);
  const wide = Math.min(names + 2 + BAR, room);
  const head: Segment[] = total > 0 && wide >= 10 ? bar(done, total, wide, t) : [];
  lines.push(line([['  '], ...head, ...tail], width));
  return lines;
}

/**
 * A finished job's line, which stays: what it extracted and how long it
 * took, or that it failed and the command to run it by hand.
 *
 *   ✓ shell     2,113 extracted in 0:02
 */
export function finishedLines(
  job: Job,
  names: number,
  command: string,
  t: Tokens,
  width: number
): string[] {
  const took = clock((job.endedAt ?? 0) - (job.startedAt ?? 0));
  if (job.state === 'done') {
    return [
      line(
        [
          [glyphs.success, t.success],
          [` ${job.label.padEnd(names)}  `, t.strong],
          [`${count(job.processed)} extracted`],
          [` in ${took}`, t.muted],
        ],
        width
      ),
    ];
  }
  const why = job.error?.message ?? "Couldn't extract it";
  return [
    line([[glyphs.failure, t.danger], [` ${job.label.padEnd(names)}  `, t.strong], [why]], width),
    hint(job.error?.hint ?? '', `Run \`${command}\` to extract it on its own.`, t, width),
  ];
}

/** Something found, as the scan lists it: its source, where it is, and what it holds or needs. */
export interface Found {
  source: string;
  label: string;
  note: string;
}

/**
 * What a scan has found so far, each with what it holds once it's counted
 * or what's in its way: as many as fit in `room` lines, and how many more.
 *
 *     imessage  ~/Library/Messages/chat.db   52,111 messages
 *     safari    ~/Library/Safari/History.db  counting…
 */
export function foundLines(found: Found[], t: Tokens, width: number, room: number): string[] {
  const shown = found.length > room ? found.slice(0, Math.max(0, room - 1)) : found;
  const sources = Math.max(0, ...shown.map(f => f.source.length));
  const labels = Math.min(40, Math.max(0, ...shown.map(f => f.label.length)));
  const lines = shown.map(f =>
    line(
      [
        [`  ${f.source.padEnd(sources)}  `],
        [`${truncatePath(f.label, labels).padEnd(labels)}  `],
        [f.note, t.muted],
      ],
      width
    )
  );
  if (shown.length < found.length) {
    lines.push(line([[`  and ${count(found.length - shown.length)} more`, t.muted]], width));
  }
  return lines;
}
