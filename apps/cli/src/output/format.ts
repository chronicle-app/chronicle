import path from 'node:path';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A number grouped for reading: 1,240. */
export const count = (n: number) => n.toLocaleString('en-US');

/** A duration the way a person says it: 40ms, 4.2s, 12s, 3m 07s, 1h 02m. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad2(Math.floor(s % 60))}s`;
  return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

/** A size in the units Finder shows, by thousands: 812 B, 4.2 MB, 107 GB. */
export function bytes(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${i > 0 && n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** A running clock: 0:07, 12:31, 1:02:09. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

/** `commands` for many, `command` for one. Record types are plural nouns. */
export function plural(noun: string, n: number): string {
  if (n === 1) return noun.endsWith('ies') ? `${noun.slice(0, -3)}y` : noun.replace(/s$/, '');
  return noun;
}

/** A date in local time to the minute: what a person scanning rows needs. */
export const date = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** At most `width` characters, an ellipsis marking the cut. */
export const truncate = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;

/**
 * A path at most `width` characters, cut in the middle: its first folder,
 * then as many of its last parts as fit, so it still says where it is and
 * the file it names, like `~/Library/…/NoteStore.sqlite`. Too narrow for
 * that, just the file: `…/NoteStore.sqlite`. Text that isn't a path, or a
 * file too long even so, is cut at the end.
 */
export function truncatePath(text: string, width: number): string {
  if (text.length <= width) return text;
  const slash = text.endsWith('/') ? '/' : '';
  const parts = text.slice(0, text.length - slash.length).split('/');
  if (parts.length < 4) return truncate(text, width);
  const head = `${parts.slice(0, 2).join('/')}/…/`;
  let tail = `${parts.at(-1)}${slash}`;
  if (head.length + tail.length > width) {
    return tail.length + 2 <= width ? `…/${tail}` : truncate(text, width);
  }
  for (const part of parts.slice(2, -1).reverse()) {
    if (head.length + part.length + 1 + tail.length > width) break;
    tail = `${part}/${tail}`;
  }
  return head + tail;
}

/** A file path relative to here, unless that climbs out. */
export function relativePath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative;
}
