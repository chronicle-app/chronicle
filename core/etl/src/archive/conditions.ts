import { parse } from 'csv-parse/sync';
import type { DatabaseColumns } from './databases.js';

/**
 * Something that's true of an export or of one file, as a manifest says it.
 * Every key in a condition must hold, and so must every condition in a list.
 * Each is checked as cheaply as it can be: `path` and `name` from a listing,
 * `head`, `csv`, and `headers` from the start of one file, `sqlite` from a
 * database's schema.
 */
export interface Condition {
  /**
   * A file or folder that's there, from where the export starts, with `*`
   * and `{name}` as in layouts. The condition's other keys check that file.
   * Without it, they check the file itself.
   */
  path?: string;
  /** The file's name, with `*`. */
  name?: string;
  /**
   * A regular expression the start of the file's text matches, without
   * flags, so `^` is the start of the file. Its named groups are captured.
   */
  head?: string;
  /** Columns the CSV's header row has, in any order. */
  csv?: string[];
  /** Headers the first message of an mbox has. */
  headers?: string[];
  /** Tables a SQLite database has, or the columns of each table. */
  sqlite?: { tables?: string[]; columns?: { [table: string]: string[] } };
  /** At least one of these holds. */
  any?: Condition[];
  /** This doesn't hold. */
  not?: Condition;
}

/** What conditions look at: an export's listing and the starts of its files, or one file. */
export interface Subject {
  /** The name of the file itself, for `name` without `path`. */
  name?: string;
  /**
   * The first path a pattern matches, from where the export starts, and what
   * its `{name}`s matched. Null when nothing does, or the subject is one file.
   */
  locate(pattern: string): Promise<{ path: string; options: { [option: string]: string } } | null>;
  /**
   * The start of a file's text, up to `bytes` of it, by its path (`''` for
   * the file itself), and whether there's more; null when it can't be read.
   */
  head(path: string, bytes: number): Promise<Page | null>;
  /** A database's columns, or null when the file isn't one on disk. */
  columns(path: string): Promise<DatabaseColumns | null>;
}

/** What a list of conditions came to. */
export interface Outcome {
  holds: boolean;
  /** What the conditions' `{name}`s and `head` groups matched. */
  captures: { [name: string]: string };
  /** The conditions that didn't hold, as a person reads them. */
  unmet: string[];
}

/** The start of a file's text, and whether the file goes on past it. */
export interface Page {
  text: string;
  more: boolean;
}

/** How much of a file a check reads first: enough for a CSV's header or an mbox's. */
export const FIRST_BYTES = 4 * 1024;

/** The most of a file `head` and its kin read, when the first bytes aren't enough. */
export const HEAD_BYTES = 64 * 1024;

const KEYS = new Set(['path', 'name', 'head', 'csv', 'headers', 'sqlite', 'any', 'not']);

/** What a condition costs to check, for checking the cheap ones first. */
function cost(condition: Condition): number {
  if (condition.sqlite) return 3;
  if (condition.head || condition.csv || condition.headers) return 2;
  if (condition.any || condition.not) return 2;
  return 0;
}

/** A `*` pattern for one name. */
function namePattern(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map(part => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join('[^/]*');
  return new RegExp(`^${source}$`);
}

/** The last header parsed, since each of a strategy's formats checks the same file in turn. */
let lastCsv: { text: string; header: string[] | null } | null = null;

/** The header row of a CSV, from the start of its text, or null when it has none. */
function csvHeader(text: string): string[] | null {
  if (lastCsv?.text !== text) lastCsv = { text, header: parseHeader(text) };
  return lastCsv.header;
}

function parseHeader(text: string): string[] | null {
  try {
    const [row] = parse(text, {
      to_line: 1,
      bom: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as string[][];
    return row ?? null;
  } catch {
    return null;
  }
}

/** The header names of an mbox's first message, lowercased, or null when it isn't an mbox. */
function mboxHeaders(text: string): Set<string> | null {
  text = text.trimStart();
  if (!text.startsWith('From ')) return null;
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (line === '') break;
    const colon = line.indexOf(':');
    if (colon > 0 && !/^\s/.test(line)) names.add(line.slice(0, colon).trim().toLowerCase());
  }
  return names;
}

/** One condition, against a subject. */
async function check(condition: Condition, subject: Subject, all: boolean): Promise<Outcome> {
  const outcome: Outcome = { holds: true, captures: {}, unmet: [] };
  const fail = (what: string): Outcome => {
    outcome.holds = false;
    outcome.unmet.push(what);
    return outcome;
  };

  let target = '';
  if (condition.path !== undefined) {
    const found = await subject.locate(condition.path);
    if (!found) return fail(`no ${condition.path}`);
    target = found.path;
    Object.assign(outcome.captures, found.options);
  }
  const name = condition.path === undefined ? subject.name : target.split('/').at(-1);
  if (condition.name !== undefined && !(name && namePattern(condition.name).test(name))) {
    return fail(`not named ${condition.name}`);
  }
  const what = target || 'the file';

  if (condition.head !== undefined || condition.csv || condition.headers) {
    let page = await subject.head(target, FIRST_BYTES);
    if (page === null) return fail(`can't read ${what}`);
    // Read on, to the most a check reads, only when what's read so far isn't enough.
    const widen = async () => {
      if (page?.more) page = (await subject.head(target, HEAD_BYTES)) ?? page;
      return page!.text;
    };
    let { text } = page;
    if (condition.head !== undefined) {
      const pattern = compile(condition.head);
      let match = pattern.exec(text);
      if (!match && page.more) match = pattern.exec((text = await widen()));
      if (!match) return fail(`${what} doesn't start like ${condition.head}`);
      for (const [group, value] of Object.entries(match.groups ?? {})) {
        if (value !== undefined) outcome.captures[group] = value;
      }
    }
    if (condition.csv) {
      if (!text.includes('\n')) text = await widen();
      const header = csvHeader(text);
      if (!header) return fail(`${what} isn't a CSV`);
      const missing = condition.csv.filter(column => !header.includes(column));
      if (missing.length > 0) return fail(`${what} has no ${missing.join(', ')} column`);
    }
    if (condition.headers) {
      if (!/\r?\n\r?\n/.test(text)) text = await widen();
      const headers = mboxHeaders(text);
      if (!headers) return fail(`${what} isn't an mbox`);
      const missing = condition.headers.filter(header => !headers.has(header.toLowerCase()));
      if (missing.length > 0) return fail(`${what}'s first message has no ${missing.join(', ')}`);
    }
  }

  if (condition.sqlite) {
    const columns = await subject.columns(target);
    if (!columns) return fail(`${what} isn't a database`);
    const tables = [
      ...(condition.sqlite.tables ?? []),
      ...Object.keys(condition.sqlite.columns ?? {}),
    ];
    const absent = tables.filter(table => !columns.has(table.toLowerCase()));
    if (absent.length > 0) return fail(`no ${absent.join(', ')} table`);
    const missing = Object.entries(condition.sqlite.columns ?? {}).flatMap(([table, wanted]) =>
      wanted
        .filter(column => !columns.get(table.toLowerCase())!.has(column.toLowerCase()))
        .map(column => `${table}.${column}`)
    );
    // Every missing column, for what a reader can't read, as long as each is listed.
    if (missing.length > 0) {
      outcome.holds = false;
      outcome.unmet.push(...missing);
      if (!all) return outcome;
    }
  }

  // Under a `path`, an alternative or an exception without its own checks that file.
  const inner = condition.path === undefined ? subject : scoped(subject, target);
  if (condition.any) {
    let held = false;
    for (const option of condition.any) {
      const result = await check(option, inner, false);
      if (result.holds) {
        Object.assign(outcome.captures, result.captures);
        held = true;
        break;
      }
    }
    if (!held) return fail(`none of ${condition.any.length} alternatives`);
  }
  if (condition.not && (await check(condition.not, inner, false)).holds) {
    return fail(`not ${describe(condition.not)}`);
  }
  return outcome;
}

/** A subject whose file itself is one of its files, for the conditions under a `path`. */
function scoped(subject: Subject, target: string): Subject {
  return {
    name: target.split('/').at(-1),
    locate: async pattern => subject.locate(pattern),
    head: (path, bytes) => subject.head(path || target, bytes),
    columns: path => subject.columns(path || target),
  };
}

/** A condition as a person reads it, in a message. */
function describe(condition: Condition): string {
  return JSON.stringify(condition);
}

/**
 * Whether conditions hold of a subject, cheapest first. A failure ends the
 * check, unless `all` asks for every condition that doesn't hold, as for
 * what a reader needs.
 */
export async function evaluate(
  conditions: Condition[] | undefined,
  subject: Subject,
  { all = false }: { all?: boolean } = {}
): Promise<Outcome> {
  const outcome: Outcome = { holds: true, captures: {}, unmet: [] };
  const ordered = [...(conditions ?? [])].sort((a, b) => cost(a) - cost(b));
  for (const condition of ordered) {
    const result = await check(condition, subject, all);
    Object.assign(outcome.captures, result.captures);
    if (!result.holds) {
      outcome.holds = false;
      outcome.unmet.push(...result.unmet);
      if (!all) break;
    }
  }
  return outcome;
}

/** A `head` pattern, compiled: throws for one that won't. */
const compile = (pattern: string) => new RegExp(pattern);

/** Throws when a condition has a key it doesn't know, none at all, or a pattern that won't compile. */
export function checkConditions(conditions: Condition[], where = 'condition'): void {
  for (const condition of conditions) {
    const keys = Object.keys(condition);
    if (keys.length === 0) throw new Error(`${where}: an empty condition`);
    const unknown = keys.filter(key => !KEYS.has(key));
    if (unknown.length > 0) throw new Error(`${where}: no condition ${unknown.join(', ')}`);
    if (condition.head !== undefined) compile(condition.head);
    for (const list of ['csv', 'headers'] as const) {
      const value = condition[list];
      if (value !== undefined && (!Array.isArray(value) || value.length === 0)) {
        throw new Error(`${where}: ${list} names nothing`);
      }
    }
    if (condition.any) checkConditions(condition.any, where);
    if (condition.not) checkConditions([condition.not], where);
  }
}
