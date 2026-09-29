# Output

How Chronicle talks to people on stderr, and the only place terminal text is
styled. Commands, loaders, and sinks build their text from this module.

## The rules

- **stdout carries only data.** Everything for people goes to stderr.
- **A command ends with one summary line**: status glyph, subject, counts,
  time, destination. `✓ shell · history  1,240 commands  in 1.7s  → out.json`
- **Hints** are dim, indented two spaces, under the summary, and appear only
  for defaults the person didn't choose (the default `--limit` cutting a run
  short, readable columns hiding schema properties, columns that didn't fit).
- **No boxes, no `====` underlines, no emoji.** One glyph set (`glyphs`):
  `✓ ✗ ! · → ↳ ━ ─ …` and braille spinner frames.
- **Color only carries meaning** (`tokens`): status (`success`, `danger`,
  `warning`), emphasis (`strong`), de-emphasis (`muted`), and one `accent`
  (the brand red) for live elements. Never call `chalk` directly.
- **Dates** in local time to the minute in tables; ISO in data. **Numbers**
  grouped (`1,240`). **Durations** as spoken (`40ms`, `4.2s`, `3m 07s`).
- **`--quiet`** prints nothing on success; errors always print.
- **Every block renders without a TTY and under `NO_COLOR`**, and no line
  exceeds the width it was given.

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
level (`--verbose` shows debug, `--quiet` only errors), aggregate events that
share a `key` (three examples, then `…and N more like this`), and in `json`
redact the fields an event marks `sensitive` unless `--log-personal` is set.
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
