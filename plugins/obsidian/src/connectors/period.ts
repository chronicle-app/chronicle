import path from 'node:path';
import { isDateRange } from '@chronicle.app/schema';

/** The vault's Daily Notes settings: where a day's note goes and how it's named. */
export interface DailyNotes {
  /** Vault-relative folder, empty for the whole vault. */
  folder: string;
  /** A Moment format for the path within the folder, such as `YYYY/MM/YYYY-MM-DD`. */
  format: string;
}

type Field = 'year' | 'month' | 'day';

/** The Moment tokens a day can be written with, as a pattern and what it captures. */
const TOKENS: { [token: string]: [pattern: string, field?: Field] } = {
  YYYY: [String.raw`(\d{4})`, 'year'],
  MMMM: ['([A-Za-z]+)', 'month'],
  MMM: ['([A-Za-z]{3})', 'month'],
  MM: [String.raw`(\d{2})`, 'month'],
  M: [String.raw`(\d{1,2})`, 'month'],
  Do: [String.raw`(\d{1,2})(?:st|nd|rd|th)`, 'day'],
  DD: [String.raw`(\d{2})`, 'day'],
  D: [String.raw`(\d{1,2})`, 'day'],
  dddd: ['[A-Za-z]+'],
  ddd: ['[A-Za-z]{3}'],
};
const PART = /\[([^\]]*)\]|YYYY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|[A-Za-z]|[^A-Za-z]/g;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/-]/g, String.raw`\$&`);

/** A captured year, month, or day as digits. An unknown month name becomes `00`, which no date has. */
function digits(value: string): string {
  const name = value.toLowerCase();
  const month = MONTHS.findIndex(month => month === name || month.slice(0, 3) === name);
  return (/^\d+$/.test(value) ? value : String(month + 1)).padStart(2, '0');
}

/** The day a note is for by the Daily Notes settings. A format with any other token names none. */
function dailyNoteDay(name: string, { folder, format }: DailyNotes): string | undefined {
  const fields: Field[] = [];
  let pattern = '';
  for (const [part, literal] of format.matchAll(PART)) {
    const token = TOKENS[part];
    if (literal !== undefined) pattern += escaped(literal);
    else if (token) {
      pattern += token[0];
      if (token[1]) fields.push(token[1]);
    } else if (/[A-Za-z]/.test(part)) return undefined;
    else pattern += escaped(part);
  }

  const within = folder.replaceAll(/^\/+|\/+$/g, '');
  if (within && !name.startsWith(`${within}/`)) return undefined;
  const match = new RegExp(`^${pattern}$`).exec(within ? name.slice(within.length + 1) : name);
  if (!match) return undefined;

  // A format can write a field twice, as `YYYY/YYYY-MM-DD` does, and both must agree.
  const date: { [field in Field]?: string } = {};
  for (const [index, field] of fields.entries()) {
    const value = digits(match[index + 1]);
    if (date[field] !== undefined && date[field] !== value) return undefined;
    date[field] = value;
  }
  const { year, month, day } = date;
  const value = `${year}-${month}-${day}`;
  return year && month && day && isDateRange(value) ? value : undefined;
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** An ISO 8601 week, Monday through Sunday, if the year has that week. */
function isoWeek(year: number, week: number): string | undefined {
  // January 4 is always in week 1.
  const january4 = new Date(Date.UTC(year, 0, 4));
  const at = (offset: number) => {
    const date = new Date(january4);
    date.setUTCDate(4 - ((january4.getUTCDay() + 6) % 7) + (week - 1) * 7 + offset);
    return date;
  };
  // A week belongs to the year its Thursday is in.
  if (at(3).getUTCFullYear() !== year) return undefined;
  return `${dayOf(at(0))}/${dayOf(at(6))}`;
}

/** The period a file name is exactly: a day, a month, or an ISO week. */
function periodOfName(name: string): string | undefined {
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(name)) return isDateRange(name) ? name : undefined;
  const week = /^(\d{4})-W(\d{2})$/.exec(name);
  return week ? isoWeek(Number(week[1]), Number(week[2])) : undefined;
}

/**
 * The period a note is named for. A bare year isn't one: a note named `1984` is
 * as likely to be about the book.
 */
export function periodCovered(handle: string, dailyNotes?: DailyNotes): string | undefined {
  const name = handle.replace(/\.md$/i, '');
  return (dailyNotes && dailyNoteDay(name, dailyNotes)) ?? periodOfName(path.posix.basename(name));
}
