/**
 * Whether a run with a candidate's options would work now.
 *
 * - `ready`: there, and it opens
 * - `blocked`: there, but macOS refused to open it (the terminal lacks Full Disk Access)
 * - `unreadable`: there, but its permissions keep it from being read
 * - `empty`: it opens, with nothing in it
 * - `signed-out`: no credential to sign in with, though the service's tools are set up
 * - `unsupported`: an export in a layout the source's plugin recognizes but can't read
 */
export type CandidateStatus =
  'ready' | 'blocked' | 'unreadable' | 'empty' | 'signed-out' | 'unsupported';

/**
 * One run a source could do on this computer: the options it takes and what
 * it would read. `chronicle extract <source>` with `config` as flags is that run.
 */
export interface Candidate {
  /** What was found, as a person names it: a profile, a vault. Without one, the scan shows `path`. */
  label?: string;
  /** The run's options, each a field of the strategy's extractor schemas. `{}` when the defaults find it. */
  config: { [option: string]: unknown };
  /** The file or folder the run reads. The scan opens it to say whether it's ready. */
  path?: string;
  /** Set when the locator knows, as for a credential. Otherwise the scan checks `path`. */
  status?: CandidateStatus;
  /** The next step when it isn't ready, in a sentence with the command in it. */
  remedy?: string;
  /** Where a credential came from, like `gh` or `GH_TOKEN`. Never the credential. */
  credential?: string;
}

/**
 * Where a manifest says a strategy's material lives: a path pattern, from
 * `chronicle.sources.<source>.strategies.<strategy>.locations`. `~` is the
 * home folder, `*` matches within one path segment, and `{name}` matches like
 * `*` and binds what it matched to the option `name`.
 */
export interface Location {
  path: string;
  /** Only on these platforms. Without it, wherever the source runs. */
  platforms?: NodeJS.Platform[];
  /** Options a run takes to read what this location matches, like `{ "shell": "bash" }`. */
  options?: { [option: string]: unknown };
}

/**
 * One path segment of a location or layout as a regular expression: `*` and
 * `{name}` match within it, and `{name}` captures what it matched as `name`.
 */
export function segmentPattern(segment: string): RegExp {
  let source = '';
  for (const part of segment.split(/(\*|\{[A-Za-z]\w*\})/)) {
    if (part === '*') source += '[^/]*';
    else if (/^\{[A-Za-z]\w*\}$/.test(part)) source += `(?<${part.slice(1, -1)}>[^/]+)`;
    else source += part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  }
  return new RegExp(`^${source}$`);
}

/** A declared location that matched: the path, and the options it binds. */
export interface LocationMatch {
  path: string;
  options: { [option: string]: unknown };
}

/** What a locator knows about the computer it's looking at. */
export interface LocateContext {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

/**
 * Finds a strategy's material on this computer, so a run can be offered
 * before anyone types a path. The manifest declares where to look, and the
 * scan matches those locations without loading plugin code. A locator then
 * refines what matched: it names it, drops what a run wouldn't read, or finds
 * what no pattern can, like a credential. It calls the extractor's own
 * lookups rather than repeating them, so a scan and a run agree.
 *
 * A locator reads only what says where material is (a profile list, a
 * registry of vaults), never the records, and stays off the network.
 */
export abstract class Locator {
  static source: string;
  static strategy: string;

  protected readonly context: LocateContext;

  constructor(context: LocateContext) {
    this.context = context;
  }

  /** This strategy's candidates, given the declared locations that matched. */
  abstract locate(matches: LocationMatch[]): AsyncGenerator<Candidate>;
}
