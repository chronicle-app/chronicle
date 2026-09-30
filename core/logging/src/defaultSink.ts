import type { Sink } from './types.js';

let current: Sink | undefined;

/**
 * Where loggers without a sink of their own send events, process-wide: a host
 * sets this once so module-level loggers (in shared packages, or created
 * before a run hands its sink over) follow its output instead of stderr.
 * Returns the sink it replaced, so a caller can restore it.
 */
export function setDefaultSink(sink: Sink | undefined): Sink | undefined {
  const previous = current;
  current = sink;
  return previous;
}

/** The process-wide sink, if a host set one. */
export const defaultSink = (): Sink | undefined => current;
