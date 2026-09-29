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

/** A file path relative to here, unless that climbs out. */
export function relativePath(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative;
}
