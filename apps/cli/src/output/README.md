# Output

How Chronicle talks to people on stderr, and the only place terminal text is
styled. Commands, loaders, and sinks build their text from this module.

## The rules

- **stdout carries only data.** Everything for people goes to stderr.
- **A command ends with a summary**: the outcome on one line (status glyph,
  subject, time, destination), then a line per record kind, and lines for
  anything failed, skipped, or written.
- **Errors** read `✗ Error: <message>`, the glyph and label in `danger`, with
  what to do as hints below. Commands stop with `this.fail(message, { hint })`
  (or `this.failFrom(error)` in a catch-all), never oclif's `this.error`;
  `BaseCommand.catch` shows anything else that escapes the same way, oclif's
  own parse errors included. Under a summary, hints appear only for defaults
  the person didn't choose (the default `--limit` cutting a run short,
  readable columns hiding schema properties). See
  [Writing messages](#writing-messages).
- **No boxes, no `====` underlines, no emoji.** One glyph set (`glyphs`):
  `✓ ✗ ! · → ↳ ━ ─ …`, braille spinner frames, and `❯ ◉ ○` for pickers.
- **Color only carries meaning** (`tokens`): status (`success`, `danger`,
  `warning`), emphasis (`strong`), de-emphasis (`muted`), one `accent` (the
  brand red) for live elements, and cyan for something to type (`code`,
  `command`). Never call `chalk` directly.
- **Dates** in local time to the minute in tables; ISO in data. **Numbers**
  grouped (`1,240`). **Durations** as spoken (`40ms`, `4.2s`, `3m 07s`).
- **`--quiet`** prints nothing on success; errors always print.
- **Every block renders without a TTY and under `NO_COLOR`**, and no line
  exceeds the width it was given, except a `url` field or a hint's command:
  each prints whole on a line of its own, since a cut URL can't be opened and
  a split command can't be copied.
- **No `console.*`.** Say things through a logger (`this.logger` in a
  command, `createLogger({ scope })` in a module); the command's sink decides
  where they go. Command output on stdout uses `this.log`.

## Writing messages

Every message should be read at a glance. One thing per line, and anything to
type on a line of its own.

```
✗ Error: github has no record type "likes"
  ↳ See its kinds:
      chronicle extract github --list-types
```

- **The first line says what happened**, in one plain sentence: sentence
  case, no period, no advice. Don't repeat what the command line already says.
- **Each next step is its own `↳` line**: a short instruction that starts
  with a verb (Name, See, Read, Sign in, Add). One step per line, never two
  joined by `·`; two steps at most, three only when there's no way around it.
  In a hint string, each line is a step.
- **A step that ends in a command** (`See its kinds: \`chronicle extract
  github --list-types\``) prints the command on its own indented line, cyan,
  without backticks, whole. Use it when the next move is a different command.
- **A flag to add to the command just run is named inline** (`Add \`--limit
  0\` to read them all`): cyan with color, in backticks without.
- **Commands are real examples** you could run as printed (`chronicle extract
shell`, not `chronicle extract <source>`). Only values the person alone has
  are placeholders (`--client-id <id>`). Prefer long flags (`--type`) unless
  the short one is the point.
- **Lists of more than about five** get a step that lists them instead (`See
its kinds: …`).
- **Plain words**: say what something does rather than what it is, and
  prefer "kinds", "sign in", "read" to jargon.

## Events and sinks

Every line on stderr is the rendering of an `OutputEvent` from
`@chronicle.app/logging`: a `kind` (`progress`, `notice`, `hint`, `summary`,
`error`, `diagnostic`), a `level`, a `scope`, the `run` it belongs to, a plain
`message`, and `fields` that hold the facts. `--log-format` picks the sink:

| sink     | time                                                      | progress                    | personal fields |
| -------- | --------------------------------------------------------- | --------------------------- | --------------- |
| `pretty` | right-aligned, muted, on notices and errors when they fit | live line, redrawn in place | shown           |
| `plain`  | `HH:MM:SS` prefix                                         | not shown                   | shown           |
| `json`   | ISO                                                       | heartbeat every 10 seconds  | redacted        |

`pretty` is the default on a terminal, `plain` otherwise. Sinks filter by
level (`--verbose` shows debug, `--quiet` only errors), and in `json` redact
the fields an event marks `sensitive` unless `--log-personal` is set. They
keep repeats from flooding: events with the same `key`, or else the same
scope and message give or take numbers, show three examples, then a roll-up
at most every five seconds with how often each value came up
(`…412 more like this in 5s  recordType: blocks 300 · connections 112`).
Put personal values in `fields`, never in the message: a message can't be
redacted.

## The pieces

- `tokens({ stream, theme })`: the color roles for stdout or stderr, with
  color detection, `NO_COLOR`, and `--theme` handled once. `plainTokens` style
  nothing.
- `glyphs`: the glyph set.
- Formatters: `count`, `duration`, `clock`, `plural`, `date`, `truncate`,
  `relativePath`.
- Blocks, each returning strings cut to a width: `line`, `summary`, `hint`,
  `heading`, `list`, `caption`, `card`, `table`, and `progress` (the live
  line).
- Sinks: `createSink`, `PrettySink`, `PlainSink`, and `render`, their shared
  look.

## The gallery

`npm run gallery -w @chronicle.app/cli` prints every block and a fixed set of
events through all three sinks, in every theme, at 40, 80, and 120 columns.
Change a token or a block, run it, and see the change everywhere. The output
test renders the same gallery and checks that nothing throws, no line exceeds
its width, `plain` has no color, and every `json` line parses.

To watch the live view on a real source, slow it down: `--delay <ms>` waits
before each extracted record, as in `chronicle extract shell --delay 50
--output /tmp/shell.json`.
