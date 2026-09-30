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
maps the common flags), and both aggregate events sharing a `key`: the first
three show, and `flush()` reports the rest as `…and N more like this`. A
`summary` event flushes first.

A logger without a sink of its own uses the process-wide one a host sets
with `setDefaultSink`, so a host can redirect every logger, including
module-level ones in shared packages. Without either, it writes plain lines
to stderr at the level its `quiet`, `verbose`, and `level` options ask for;
errors always print. With `sensitive: true` every field it logs is marked
personal.

`captureConsole(logger)` routes `console.*` through a logger as diagnostics
until the function it returns restores the console, for code the host doesn't
control. Chronicle's own code never calls `console`; lint enforces it.

MIT. See [LICENSE](LICENSE).
