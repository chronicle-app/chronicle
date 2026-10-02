/**
 * Exit codes a supervisor can act on without reading messages: whether to
 * report a bug, fix the invocation, get a person to re-authorize or fix
 * access, or retry later.
 */
export const EXIT_CODES = {
  internal: 1,
  usage: 2,
  auth: 3,
  input: 4,
  transient: 5,
} as const;

export interface ExtractorErrorOptions {
  /** A stable name for what went wrong: `auth-required`, `input-not-found`. */
  code?: string;
  exitCode?: number;
  /** The next move for a person: `run chronicle auth login arena`. */
  hint?: string;
  /** Facts about the failure. Personal unless listed in `safe`. */
  fields?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * A failure a plugin can name. The runner reports it as an `error` event with
 * its code, exit code, and hint, and the CLI exits with its code, so a person
 * gets a next step and a supervisor can decide what to do without matching
 * text. Put personal values (paths, names) in `fields`, not the message.
 */
export class ExtractorError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string;
  readonly fields?: Record<string, unknown>;

  constructor(message: string, options: ExtractorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? 'extractor-error';
    this.exitCode = options.exitCode ?? EXIT_CODES.internal;
    this.hint = options.hint;
    this.fields = options.fields;
  }
}

/** No credentials, or they expired or were revoked: a person has to sign in. */
export class AuthRequired extends ExtractorError {
  constructor(
    message: string,
    options: Omit<ExtractorErrorOptions, 'code' | 'exitCode'> & { source?: string } = {}
  ) {
    const { source, ...rest } = options;
    super(message, {
      code: 'auth-required',
      exitCode: EXIT_CODES.auth,
      hint: source ? `Run \`chronicle auth login ${source}\` to sign in.` : undefined,
      ...rest,
    });
  }
}

/** The operating system refused access: permissions, or macOS privacy controls. */
export class PermissionDenied extends ExtractorError {
  constructor(
    message: string,
    options: Omit<ExtractorErrorOptions, 'code' | 'exitCode'> & { path?: string } = {}
  ) {
    const { path, ...rest } = options;
    super(message, {
      code: 'permission-denied',
      exitCode: EXIT_CODES.input,
      ...rest,
      fields: { ...(path && { path }), ...rest.fields },
    });
  }
}

/** The input the source reads from isn't there, or isn't what it expects. */
export class InputNotFound extends ExtractorError {
  constructor(
    message: string,
    options: Omit<ExtractorErrorOptions, 'code' | 'exitCode'> & { path?: string } = {}
  ) {
    const { path, ...rest } = options;
    super(message, {
      code: 'input-not-found',
      exitCode: EXIT_CODES.input,
      ...rest,
      fields: { ...(path && { path }), ...rest.fields },
    });
  }
}

/** The source throttled us; `retryAfter` says how long to wait, when it said. */
export class RateLimited extends ExtractorError {
  readonly retryAfter?: number;

  constructor(
    message: string,
    options: Omit<ExtractorErrorOptions, 'code' | 'exitCode'> & { retryAfter?: number } = {}
  ) {
    const { retryAfter, ...rest } = options;
    super(message, {
      code: 'rate-limited',
      exitCode: EXIT_CODES.transient,
      hint: retryAfter === undefined ? 'Try again later.' : `Try again in ${retryAfter}s.`,
      ...rest,
      fields: { ...(retryAfter !== undefined && { retryAfter }), ...rest.fields },
    });
    this.retryAfter = retryAfter;
  }
}

/**
 * The code, exit code, and hint of any thrown value, typed or not. Duck-typed,
 * so an error from a plugin built against another copy of this package still
 * reads as what it is.
 */
export function describeError(error: unknown): {
  message: string;
  code: string;
  exitCode: number;
  hint?: string;
  fields?: Record<string, unknown>;
  stack?: string;
} {
  const e = error as Partial<ExtractorError> & { message?: unknown; stack?: string };
  const typed = typeof e?.code === 'string' && typeof e?.exitCode === 'number';
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typed ? e.code! : 'internal',
    exitCode: typed ? e.exitCode! : EXIT_CODES.internal,
    ...(typed && e.hint && { hint: e.hint }),
    ...(typed && e.fields && { fields: e.fields }),
    ...(e?.stack && { stack: e.stack }),
  };
}

const REPORTED = Symbol.for('chronicle.error.reported');

/** Note that an error was already reported as an event, so a host doesn't print it twice. */
export function markReported(error: unknown): void {
  if (typeof error === 'object' && error !== null) (error as any)[REPORTED] = true;
}

/** Whether an error was already reported as an event. */
export const isReported = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as any)[REPORTED] === true;
