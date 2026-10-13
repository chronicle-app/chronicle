import type { Command } from '@oclif/core';
import {
  definitions,
  heading,
  paragraph,
  type Definition,
  type Segment,
  type Tokens,
} from '../output/index.js';

/**
 * Every help screen, drawn with the output module's blocks: the root, a topic
 * (`chronicle auth`), a command, and a source (`chronicle extract shell
 * --help`). Each takes plain data, so the gallery can draw them without oclif
 * or a plugin. See the output README for the style.
 */

export const BIN = 'chronicle';

/** The width help is laid out to: `OCLIF_COLUMNS`, else the terminal's, else 80. */
export function helpWidth(): number {
  const columns = Number.parseInt(process.env.OCLIF_COLUMNS ?? '', 10);
  if (columns > 0) return columns;
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns - 1 : 80;
}

/** A command id as it's typed: `auth list`, not `auth:list`. */
export const typed = (id: string) => id.replaceAll(':', ' ');

/** A command or topic in a list, and what it does. */
export interface Entry {
  name: string;
  summary?: string;
}

/** What a flag's help needs: oclif's cached flags and its definitions both have it. */
export interface FlagLike {
  name: string;
  char?: string;
  type: 'boolean' | 'option';
  summary?: string;
  description?: string;
  helpGroup?: string;
  helpValue?: string | string[];
  options?: readonly string[];
  default?: unknown;
  required?: boolean;
  allowNo?: boolean;
  multiple?: boolean;
  hidden?: boolean;
}

/** A blank line, the heading, and the lines under it; nothing when there are none. */
function section(title: string, body: string[], t: Tokens, width: number): string[] {
  return body.length === 0 ? [] : ['', heading(title, t, width), ...body];
}

/** A command to type, on a line of its own. Never cut: a cut command can't be copied. */
const commandLine = (text: string, t: Tokens, indent = 2) =>
  `${' '.repeat(indent)}${t.command(text)}`;

/** oclif's templates in help text, filled in for this command, without a `$` prompt. */
function fill(text: string, id = ''): string {
  return text
    .replaceAll(/<%=\s*config\.bin\s*%>/g, BIN)
    .replaceAll(/<%=\s*command\.id\s*%>/g, typed(id))
    .replace(/^\$\s+/, '');
}

/** Paragraphs split at blank lines, the lines of each joined and wrapped. */
function prose(text: string | undefined, t: Tokens, width: number): string[] {
  if (!text?.trim()) return [];
  return text
    .trim()
    .split(/\n\s*\n/)
    .flatMap((part, i) => [
      ...(i > 0 ? [''] : []),
      ...paragraph(part.replaceAll(/\s*\n\s*/g, ' '), t, width),
    ]);
}

const entries = (items: Entry[], t: Tokens, width: number) =>
  definitions(
    items.map(({ name, summary }) => ({ term: [[name, t.command]], text: summary })),
    t,
    width
  );

/** How a flag is typed: `-l, --limit <n>`, `--[no-]headers`, `--format <table|json|csv>`. */
function flagTerm(flag: FlagLike, t: Tokens, pad: boolean): Segment[] {
  const name = flag.type === 'boolean' && flag.allowNo ? `--[no-]${flag.name}` : `--${flag.name}`;
  const short = flag.char ? `-${flag.char}, ` : pad ? '    ' : '';
  if (flag.type === 'boolean') return [[`${short}${name}`, t.command]];
  const help = Array.isArray(flag.helpValue) ? flag.helpValue.join('|') : flag.helpValue;
  const value = flag.options?.length
    ? `<${flag.options.join('|')}>`
    : help
      ? help.startsWith('<')
        ? help
        : `<${help}>`
      : '<value>';
  return [
    [`${short}${name}`, t.command],
    [` ${value}${flag.multiple ? '...' : ''}`, t.muted],
  ];
}

/** The default worth saying: not an unset, empty, or computed one. */
function defaultNote(flag: FlagLike): string | undefined {
  const value = flag.default;
  if (value === undefined || value === '' || value === false || typeof value === 'function') return;
  if (Array.isArray(value) && value.length === 0) return;
  return `default: ${value === true ? 'on' : String(value)}`;
}

/** Flags as terms and text, the short forms lined up when any flag has one. */
export function flagDefinitions(flags: FlagLike[], t: Tokens): Definition[] {
  const pad = flags.some(flag => flag.char);
  return flags.map(flag => {
    const notes = [flag.required ? 'required' : undefined, defaultNote(flag)].filter(Boolean);
    return {
      term: flagTerm(flag, t, pad),
      text: fill(flag.summary ?? flag.description?.split('\n')[0] ?? ''),
      ...(notes.length > 0 && { note: notes.join(', ') }),
    };
  });
}

/** `FILTER` is "Filter flags"; flags without a group are just "Flags". */
const groupTitle = (group: string | undefined) =>
  group ? `${group.charAt(0).toUpperCase()}${group.slice(1).toLowerCase()} flags` : 'Flags';

/** A command's flags by group: its own first, then the others, global flags last. */
function flagSections(flags: FlagLike[], t: Tokens, width: number): string[] {
  const groups = new Map<string, FlagLike[]>();
  const shown = flags.filter(flag => !flag.hidden).sort((a, b) => a.name.localeCompare(b.name));
  for (const flag of shown) {
    const title = groupTitle(flag.helpGroup);
    groups.set(title, [...(groups.get(title) ?? []), flag]);
  }
  const order = [...groups.keys()].sort(
    (a, b) =>
      Number(a === 'Global flags') - Number(b === 'Global flags') ||
      Number(b === 'Flags') - Number(a === 'Flags')
  );
  return order.flatMap(title =>
    section(title, definitions(flagDefinitions(groups.get(title)!, t), t, width), t, width)
  );
}

/** Examples to copy, each under its description when it has one. */
function examples(list: Command.Example[] | undefined, id: string, t: Tokens, width: number) {
  const lines: string[] = [];
  for (const example of list ?? []) {
    if (typeof example === 'string') {
      lines.push(commandLine(fill(example, id), t));
      continue;
    }
    if (lines.length > 0) lines.push('');
    lines.push(
      ...paragraph(fill(example.description, id), t, width, 2),
      commandLine(fill(example.command, id), t, 4)
    );
  }
  return lines;
}

/** How a command is typed: its own usage, else its arguments and `[flags]`. */
function usage(command: Command.Cached): string[] {
  if (command.usage) {
    return [command.usage]
      .flat()
      .map(text => fill(text, command.id))
      .map(text => (text.startsWith(`${BIN} `) ? text : `${BIN} ${text}`));
  }
  const args = Object.values(command.args ?? {}).map(arg =>
    arg.required ? `<${arg.name}>` : `[${arg.name}]`
  );
  const hasFlags = Object.values(command.flags ?? {}).some(flag => !flag.hidden);
  return [[BIN, typed(command.id), ...args, ...(hasFlags ? ['[flags]'] : [])].join(' ')];
}

/** The first line of a command's summary or description, and the rest of its description. */
export function summaryOf(command: Pick<Command.Cached, 'summary' | 'description' | 'id'>) {
  const description = fill(command.description ?? '', command.id).trim();
  if (command.summary) return { summary: fill(command.summary, command.id), description };
  const [first = '', ...rest] = description.split('\n');
  return { summary: first, description: rest.join('\n') };
}

/** Plain summaries for the commands oclif's plugins bring. */
export const PLUGIN_SUMMARIES: Record<string, string> = {
  autocomplete: 'Set up tab completion for your shell',
  help: 'Show help for a command',
};

/** What a command does in a list: ours as written, a plugin's in plain words. */
export function listedSummary(command: Pick<Command.Cached, 'summary' | 'description' | 'id'>) {
  return PLUGIN_SUMMARIES[command.id] ?? summaryOf(command).summary;
}

export interface RootInput {
  version: string;
  summary?: string;
  commands: Entry[];
}

/** `chronicle --help`: what Chronicle is, and its commands. */
export function rootHelp({ version, summary, commands }: RootInput, t: Tokens, width: number) {
  return [
    heading(`Chronicle ${version}`, t, width),
    ...prose(summary, t, width),
    ...section('Usage', [commandLine(`${BIN} <command> [flags]`, t)], t, width),
    ...section('Commands', entries(commands, t, width), t, width),
    '',
    ...paragraph('Add `--help` to any command to see its flags.', t, width),
  ].join('\n');
}

export interface TopicInput {
  name: string;
  description?: string;
  /** Its commands and the topics under it. */
  commands: Entry[];
}

/** `chronicle auth --help`: a group of commands. */
export function topicHelp({ name, description, commands }: TopicInput, t: Tokens, width: number) {
  return [
    ...prose(description, t, width),
    ...section('Usage', [commandLine(`${BIN} ${typed(name)} <command>`, t)], t, width),
    ...section('Commands', entries(commands, t, width), t, width),
  ].join('\n');
}

/** `chronicle sources --help`: a command, its arguments, flags, examples, and commands under it. */
export function commandHelp(
  command: Command.Cached,
  { commands = [], summary }: { commands?: Entry[]; summary?: string },
  t: Tokens,
  width: number
) {
  const own = summaryOf(command);
  // Whether one is optional is the usage line's to say.
  const args = Object.values(command.args ?? {}).map(arg => ({
    term: [[`<${arg.name}>`, t.command]] as Segment[],
    text: arg.description,
  }));
  const aliases = (command.aliases ?? []).filter(alias => alias !== command.id);
  return [
    ...prose(summary ?? own.summary, t, width),
    ...(own.description ? ['', ...prose(own.description, t, width)] : []),
    ...section(
      'Usage',
      usage(command).map(text => commandLine(text, t)),
      t,
      width
    ),
    ...section(
      aliases.length > 1 ? 'Aliases' : 'Alias',
      aliases.map(alias => commandLine(`${BIN} ${typed(alias)}`, t)),
      t,
      width
    ),
    ...section('Arguments', definitions(args, t, width), t, width),
    ...flagSections(
      Object.entries(command.flags ?? {}).map(([name, flag]) => ({ ...flag, name }) as FlagLike),
      t,
      width
    ),
    ...section('Examples', examples(command.examples, command.id, t, width), t, width),
    ...section('Commands', entries(commands, t, width), t, width),
  ].join('\n');
}

/** How a strategy's records reach Chronicle, as a person would put it. */
export const DELIVERY: Record<string, string> = {
  export: 'From an export you pass with `--input`',
  api: "From the service's API, once you've signed in",
  local: 'From files on this computer',
  direct: 'Delivered by the app',
};

export interface SourceHelpInput {
  source: string;
  /** The command it runs under: `extract`. */
  verb: string;
  strategies: { name: string; delivery: string; default: boolean; recordTypes: string[] }[];
  /** The source's own flags. */
  flags: FlagLike[];
  /** The flags every source shares that are worth listing beside its own. */
  common: FlagLike[];
  /** What a run without record types extracts: some, `all`, or none when it asks. */
  defaults?: string[] | 'all';
}

/** What a run without record types extracts, as a sentence or two. */
function defaultsSentence(defaults: SourceHelpInput['defaults']): string {
  if (defaults === 'all') return 'The default is every record type.';
  const opening = defaults
    ? `The default is ${defaults.join(', ')}.`
    : "There's no default; you'll be asked.";
  return `${opening} Use \`-t all\` for every record type.`;
}

/** `chronicle extract shell --help`: a source's strategies, record types, and flags. */
export function sourceHelp(input: SourceHelpInput, t: Tokens, width: number): string {
  const { source, verb, strategies, flags, common, defaults } = input;
  const strategyFlag: FlagLike[] =
    strategies.length > 1
      ? [
          {
            name: 'strategy',
            type: 'option',
            options: strategies.map(strategy => strategy.name),
            summary: 'How to extract it',
          },
        ]
      : [];
  return [
    heading(source, t, width),
    ...paragraph(defaultsSentence(defaults), t, width),
    ...section('Usage', [commandLine(`${BIN} ${verb} ${source} [type...] [flags]`, t)], t, width),
    ...section(
      'Strategies',
      definitions(
        strategies.map(strategy => ({
          term: [[strategy.name, t.command]],
          text:
            `${DELIVERY[strategy.delivery] ?? strategy.delivery}.` +
            `${strategy.default ? ' The default.' : ''}\n` +
            `Record types: ${strategy.recordTypes.join(', ')}`,
        })),
        t,
        width
      ),
      t,
      width
    ),
    ...section(
      'Flags',
      definitions(flagDefinitions([...strategyFlag, ...flags], t), t, width),
      t,
      width
    ),
    ...section('Common flags', definitions(flagDefinitions(common, t), t, width), t, width),
  ].join('\n');
}
