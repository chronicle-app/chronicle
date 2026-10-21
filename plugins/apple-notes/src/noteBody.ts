import { gunzipSync } from 'node:zlib';

/**
 * A note's body as Notes stores it: a gzipped protobuf holding a text CRDT.
 * The visible text, its formatting runs, and, for each character, the replica
 * (a Notes install on one device) that typed it. Deleted text is not kept:
 * its spans stay as tombstones with an ID and a length, but no characters.
 */
export interface NoteBody {
  text: string;
  runs: Run[];
  /** For each UTF-16 unit of `text`, the 1-based index into `replicas` of the replica that typed it, or 0. */
  replicaAt: Uint16Array;
  /** Replica UUIDs, in the note's own order. The same install keeps its UUID across notes. */
  replicas: string[];
}

/** A stretch of text with one set of attributes, its length in UTF-16 units. */
export interface Run {
  start: number;
  length: number;
  /** Paragraph style: 0 title, 1 heading, 2 subheading, 4 monospaced, 100–103 lists. */
  style?: number;
  indent: number;
  /** A checklist item's state, when the paragraph is one. */
  checked?: boolean;
  /** 1 bold, 2 italic, 3 both. */
  weight?: number;
  strikethrough: boolean;
  link?: string;
  /** The attachment this run's U+FFFC stands for, by its identifier. */
  attachment?: string;
  /**
   * When the run's text was written, in Unix seconds. Notes has kept this
   * since 2021 (iOS 15). Older text has none.
   */
  writtenAt?: number;
}

const STYLE = {
  title: 0,
  heading: 1,
  subheading: 2,
  monospaced: 4,
  dotted: 100,
  dashed: 101,
  numbered: 102,
  checklist: 103,
} as const;

interface Field {
  n: number;
  value: number | Uint8Array;
}

function varint(buf: Uint8Array, at: number): [number, number] {
  let value = 0;
  let scale = 1;
  for (let i = at; ; i++) {
    const byte = buf[i];
    value += (byte % 0x80) * scale;
    if (byte < 0x80) return [value, i + 1];
    scale *= 128;
  }
}

/** Read one protobuf message's fields, without a schema. */
function fields(buf: Uint8Array | undefined): Field[] {
  const out: Field[] = [];
  if (!buf) return out;
  let i = 0;
  while (i < buf.length) {
    const [key, next] = varint(buf, i);
    const n = Math.floor(key / 8);
    const wire = key % 8;
    i = next;
    switch (wire) {
      case 0: {
        const [value, after] = varint(buf, i);
        out.push({ n, value });
        i = after;
        break;
      }
      case 2: {
        const [length, after] = varint(buf, i);
        out.push({ n, value: buf.subarray(after, after + length) });
        i = after + length;
        break;
      }
      case 1:
      case 5: {
        const size = wire === 1 ? 8 : 4;
        out.push({ n, value: buf.subarray(i, i + size) });
        i += size;
        break;
      }
      default:
        throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
  return out;
}

const num = (fs: Field[], n: number) => {
  const value = fs.find(f => f.n === n)?.value;
  return typeof value === 'number' ? value : undefined;
};
const bytes = (fs: Field[], n: number) => {
  const value = fs.find(f => f.n === n)?.value;
  return value instanceof Uint8Array ? value : undefined;
};
const all = (fs: Field[], n: number) =>
  fs.filter(f => f.n === n && f.value instanceof Uint8Array).map(f => f.value as Uint8Array);
const utf8 = (value: Uint8Array | undefined) =>
  value ? new TextDecoder().decode(value) : undefined;

function uuid(value: Uint8Array): string {
  const hex = Buffer.from(value).toString('hex').toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Decode `ZICNOTEDATA.ZDATA`. */
export function decodeNoteBody(data: Uint8Array): NoteBody {
  const document = fields(bytes(fields(gunzipSync(data)), 2));
  const note = fields(bytes(document, 3));
  const text = utf8(bytes(note, 2)) ?? '';

  const replicas = all(fields(bytes(note, 4)), 1).map(clock => uuid(bytes(fields(clock), 1)!));

  // Substrings are stored in document order; the visible text is the
  // concatenation of those that aren't tombstoned.
  const replicaAt = new Uint16Array(text.length);
  let at = 0;
  for (const raw of all(note, 3)) {
    const substring = fields(raw);
    const length = num(substring, 2) ?? 0;
    if (num(substring, 4)) continue;
    const replica = num(fields(bytes(substring, 1)), 1) ?? 0;
    replicaAt.fill(replica, at, Math.min(at + length, text.length));
    at += length;
  }

  const runs: Run[] = [];
  let start = 0;
  for (const raw of all(note, 5)) {
    const run = fields(raw);
    const paragraph = fields(bytes(run, 2));
    const checklist = bytes(paragraph, 5);
    const length = num(run, 1) ?? 0;
    runs.push({
      start,
      length,
      style: num(paragraph, 1),
      indent: num(paragraph, 4) ?? 0,
      ...(checklist && { checked: num(fields(checklist), 2) === 1 }),
      weight: num(run, 5),
      strikethrough: Boolean(num(run, 7)),
      link: utf8(bytes(run, 9)),
      attachment: utf8(bytes(fields(bytes(run, 12)), 1)),
      writtenAt: num(run, 13),
    });
    start += length;
  }
  return { text, runs, replicaAt, replicas };
}

/**
 * Decode `ZREPLICAIDTOUSERIDDICTDATA`: for each replica that has edited the
 * note, the CloudKit user ID of the person it belongs to. It's a CRDT
 * dictionary, stored like the note's text: objects that refer to each other
 * by index, here one dictionary whose keys and values each hold one string.
 */
export function decodeReplicaUsers(data: Uint8Array): Map<string, string> {
  const objects = all(fields(data), 3).map(raw => fields(raw));
  const string = (index: number | undefined) => {
    const custom = index === undefined ? undefined : bytes(objects[index] ?? [], 13);
    return utf8(bytes(fields(bytes(fields(bytes(fields(custom), 3)), 2)), 4));
  };
  const users = new Map<string, string>();
  for (const dictionary of objects.flatMap(object => all(object, 6))) {
    for (const raw of all(fields(dictionary), 1)) {
      const entry = fields(raw);
      const replica = string(num(fields(bytes(entry, 1)), 6));
      const user = string(num(fields(bytes(entry, 2)), 6));
      if (replica && user) users.set(replica.toUpperCase(), user);
    }
  }
  return users;
}

/** How an attachment reads in the text, such as `#travel` or `[image: receipt.jpeg]`. */
export type AttachmentText = (identifier: string) => string;

/** The note as Markdown: headings, lists, checklists, code, emphasis, and links. */
export function noteMarkdown(body: NoteBody, attachmentText: AttachmentText): string {
  return markdown(body, 0, body.text.length, attachmentText);
}

/**
 * The text from `from` to `to` as Markdown. A line keeps its heading, list, or
 * checklist marker when the range starts it; the end of a line begun earlier
 * has none.
 */
function markdown(body: NoteBody, from: number, to: number, attachmentText: AttachmentText) {
  const lines: string[] = [];
  let inCode = false;
  let start = from;
  for (const end of [...newlines(body.text, from, to), to]) {
    // A range that ends with a newline doesn't reach into the next line.
    if (start === to && to < body.text.length) break;
    const paragraphStart = start === 0 ? 0 : body.text.lastIndexOf('\n', start - 1) + 1;
    const run = runAt(body.runs, paragraphStart);
    const content = inline(body, start, end, attachmentText);
    const code = run?.style === STYLE.monospaced;
    if (code !== inCode) {
      lines.push('```');
      inCode = code;
    }
    if (code) lines.push(body.text.slice(start, end));
    else lines.push(start === paragraphStart ? prefix(run) + content : content.trimStart());
    start = end + 1;
  }
  if (inCode) lines.push('```');
  return lines.join('\n');
}

function newlines(text: string, from: number, to: number): number[] {
  const at: number[] = [];
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1))
    at.push(i);
  return at;
}

/** The index of the first run that ends after `position`; runs are in document order. */
function firstRunAfter(runs: Run[], position: number): number {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (runs[mid].start + runs[mid].length <= position) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The runs that overlap `from`–`to`, each with its overlapping slice. */
function* runsBetween(body: NoteBody, from: number, to: number) {
  for (let i = firstRunAfter(body.runs, from); i < body.runs.length; i++) {
    const run = body.runs[i];
    if (run.start >= to) return;
    const start = Math.max(run.start, from);
    const end = Math.min(run.start + run.length, to);
    if (start < end) yield { run, text: body.text.slice(start, end) };
  }
}

function runAt(runs: Run[], position: number): Run | undefined {
  const run = runs[firstRunAfter(runs, position)];
  return run && run.start <= position ? run : undefined;
}

function prefix(run: Run | undefined): string {
  const indent = '  '.repeat(run?.indent ?? 0);
  switch (run?.style) {
    case STYLE.title:
      return '# ';
    case STYLE.heading:
      return '## ';
    case STYLE.subheading:
      return '### ';
    case STYLE.dotted:
    case STYLE.dashed:
      return `${indent}- `;
    case STYLE.numbered:
      return `${indent}1. `;
    case STYLE.checklist:
      return `${indent}- [${run.checked ? 'x' : ' '}] `;
    default:
      return '';
  }
}

/** The text with the attachment's placeholder (U+FFFC) spelled out. */
function withAttachment(text: string, attachment: string, attachmentText: AttachmentText) {
  return text.replaceAll(String.fromCodePoint(0xff_fc), () => attachmentText(attachment));
}

/** One paragraph's text with its emphasis, links, and attachments. */
function inline(body: NoteBody, from: number, to: number, attachmentText: AttachmentText): string {
  let out = '';
  for (const slice of runsBetween(body, from, to)) {
    const { run } = slice;
    let { text } = slice;
    if (run.attachment) {
      out += withAttachment(text, run.attachment, attachmentText);
      continue;
    }
    if (run.style === STYLE.title || run.style === STYLE.heading) {
      out += text;
      continue;
    }
    const marks =
      (run.weight === 1 ? '**' : run.weight === 2 ? '*' : run.weight === 3 ? '***' : '') +
      (run.strikethrough ? '~~' : '');
    if (marks && text.trim()) {
      // Markdown emphasis can't open or close on a space.
      const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
      text = `${lead}${marks}${core}${[...marks].reverse().join('')}${trail}`;
    }
    if (run.link && text.trim()) text = `[${text}](${run.link})`;
    out += text;
  }
  return out;
}

/** A burst of one person's writing in one note: the text from it that's still there. */
export interface WritingSession {
  start: number;
  end: number;
  /** Who wrote it, as `authorOf` names them, or null when no one is known. */
  author: string | null;
  /** Where the surviving text sits in the note, as UTF-16 ranges in document order. */
  ranges: Array<[number, number]>;
  /** Replica UUIDs that typed it, most text first. */
  replicas: string[];
  characters: number;
}

interface Piece {
  start: number;
  end: number;
  writtenAt: number;
}

/**
 * Group a note's timed runs into sessions: one person's writing, with no gap
 * longer than `gapSeconds`. `authorOf` names the person a replica, by its
 * 1-based index, belongs to; without it, all the writing is one unknown
 * person's. A session only has the text that survives, so one whose text was
 * all deleted later doesn't appear.
 */
export function writingSessions(
  body: NoteBody,
  gapSeconds: number,
  authorOf: (replica: number) => string | null = () => null
): WritingSession[] {
  const authors = body.replicas.map((_, i) => authorOf(i + 1));
  const authorAt = (position: number) => authors[body.replicaAt[position] - 1] ?? null;

  // Each timed run, split where the person typing it changes.
  const byAuthor = new Map<string | null, Piece[]>();
  for (const run of body.runs) {
    if (run.writtenAt === undefined || run.length === 0) continue;
    const end = run.start + run.length;
    let from = run.start;
    for (let i = from + 1; i <= end; i++) {
      if (i < end && authorAt(i) === authorAt(from)) continue;
      const pieces = byAuthor.get(authorAt(from)) ?? [];
      pieces.push({ start: from, end: i, writtenAt: run.writtenAt });
      byAuthor.set(authorAt(from), pieces);
      from = i;
    }
  }

  const sessions: WritingSession[] = [];
  for (const [author, pieces] of byAuthor) {
    const times = [...new Set(pieces.map(piece => piece.writtenAt))].sort((a, b) => a - b);
    const sessionOf = new Map<number, WritingSession>();
    let last: WritingSession | undefined;
    for (const time of times) {
      if (last && time - last.end <= gapSeconds) last.end = time;
      else {
        last = { start: time, end: time, author, ranges: [], replicas: [], characters: 0 };
        sessions.push(last);
      }
      sessionOf.set(time, last);
    }
    for (const piece of pieces) {
      const session = sessionOf.get(piece.writtenAt)!;
      const range = session.ranges.at(-1);
      if (range && range[1] === piece.start) range[1] = piece.end;
      else session.ranges.push([piece.start, piece.end]);
      session.characters += piece.end - piece.start;
    }
  }
  for (const session of sessions) {
    const counts = new Map<number, number>();
    for (const [from, to] of session.ranges)
      for (let i = from; i < to; i++)
        counts.set(body.replicaAt[i], (counts.get(body.replicaAt[i]) ?? 0) + 1);
    session.replicas = [...counts]
      .filter(([replica]) => replica > 0 && replica <= body.replicas.length)
      .sort((a, b) => b[1] - a[1])
      .map(([replica]) => body.replicas[replica - 1]);
  }
  return sessions;
}

/**
 * The session's surviving text as Markdown, as the note's is, its separate
 * pieces joined by an ellipsis line.
 */
export function sessionText(
  body: NoteBody,
  session: WritingSession,
  attachmentText: AttachmentText
): string {
  return session.ranges
    .map(([from, to]) =>
      markdown(body, from, to, attachmentText)
        .replace(/^(?:[ \t]*\n)+/, '')
        .trimEnd()
    )
    .filter(Boolean)
    .join('\n…\n');
}
