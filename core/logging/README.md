# @chronicle.app/logging

Chronicle's output events and the sinks that render them. Node.js 22.13+; ESM
with TypeScript declarations.

```js
import { createLogger, JsonSink } from '@chronicle.app/logging';

const logger = createLogger({ scope: 'example', verbose: true });
logger.info('Extracted records', { count: 3 });
logger.debug('Source cursor', { position: 3 });

// A host hands its own sink over; events then render its way.
logger.use(new JsonSink(), { run: { id: 'run-1', source: 'example', strategy: 'file' } });
logger.warn('Line skipped', { line: 42 });
```

Each logger call becomes an `OutputEvent`: a `kind`, a `level`, the logger's
`scope` and `run`, a plain `message`, and the second argument as `fields`.
`debug` and `verboseInfo` are debug-level diagnostics, `info` and `warn` are
notices, and `error` is an error. `emit` sends any event, including the host's
`progress`, `hint`, and `summary`.

A sink decides what to show and how. `TextSink` writes lines to stderr; by
default each is `HH:MM:SS level scope: message key=value`, and a host passes
its own `format`. `JsonSink` writes one JSON object per line, turns progress
into a heartbeat, and redacts the fields an event marks `sensitive` unless
`personal` is set. Both filter by `level` (`thresholdFor({ quiet, verbose })`
maps the common flags), and both keep repeated events from flooding.

Events group by their `key`, or without one by scope and message with the
numbers taken out (`Generated 1 actions` and `Generated 3 actions` are one
group). Each group shows its first three events, then counts the rest and
reports them as a roll-up (`…412 more like this in 5s`) at most every five
seconds, or every second for warnings and errors. A roll-up's fields hold
the count and how often each field value came up; personal values go under
`personal`, which JSON redacts. `flush()` reports what's left as `…and N more
like this`, and a `summary` event flushes first. Pass `aggregate: { examples,
windowMs, urgentWindowMs }` to a sink to change the numbers.

A logger without a sink of its own uses the process-wide one a host sets
with `setDefaultSink`, so a host can redirect every logger, including
module-level ones in shared packages. Without either, it writes plain lines
to stderr at the level its `quiet`, `verbose`, and `level` options ask for;
errors always print. With `sensitive: true` every field it logs is marked
personal.

`captureConsole(logger)` routes `console.*` through a logger as diagnostics
until the function it returns restores the console, for code the host doesn't
control. Chronicle's own code never calls `console`; lint enforces it.

## Errors

`ExtractorError` and its subclasses name a failure so hosts can act on it
without reading the message: `AuthRequired` (exit code 3), `PermissionDenied`
and `InputNotFound` (4), `RateLimited` with `retryAfter` (5), and
`ExtractorError` itself with any `code` (1 unless given). Each carries a
`hint`, the next step for a person, and `fields`, which are personal.
`EXIT_CODES` lists the codes: 1 internal, 2 usage, 3 auth, 4 input, 5
transient. `describeError` reads the code, exit code, and hint of any thrown
value, duck-typed so an error from another copy of this package still reads
as what it is. `markReported` and `isReported` let a host that already
reported an error as an event avoid printing it twice.

MIT. See [LICENSE](LICENSE).
