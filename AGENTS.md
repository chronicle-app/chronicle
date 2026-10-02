# Working on Chronicle

Chronicle extracts personal history into a shared vocabulary.

- Use TypeScript, ESM, npm workspaces, and Node.js 22.13+.
- Shared packages live in `core/`; source plugins live in `plugins/`.
- Use built-in `node:sqlite` for SQLite extraction and open source databases
  read-only.
- Keep the schema small. Add terms only when a plugin needs them. Edit
  `core/schema/chronicle.ttl`, then run `npm run schema:generate`; do not hand-edit
  generated schema code.
- A source's default record types are the plugin's call: mark the extractors
  a bare run reads with `static default = true`, or none, and a bare run asks
  which (`-t all` and `-t defaults` name every kind and the defaults). Give
  extractors `occurredAt(record)` so several kinds merge newest first; without
  it they run one after another.
- A plugin keeps a generated `SHAPES.md`: its `shapes.test.js` runs every
  extractor over the fixtures and sketches each record type as a tree of the
  nodes it becomes, with their keys and properties (`sampleTransform`,
  `shapesOf`, `renderShapes` from `@chronicle.app/etl`). After changing a
  transformer or its fixtures, run `npm run shapes` in the plugin and review
  the diff.
- Prefer a few integration tests over many unit tests. Test through the
  highest practical boundary: the CLI, a plugin's full pipeline, or a script
  run as a process. Use synthetic files and databases, and keep personal data
  out of fixtures and logs.
- Add a unit test only for logic that is hard to reach from outside, such as
  parsing edge cases or retry loops. Don't test what a nearby integration test
  already covers, or what Node or a library already guarantees.
- When changing behavior, extend an existing test before adding a new one.
- Style terminal output with `apps/cli/src/output/`, and follow its
  [style guide](apps/cli/src/output/README.md). Don't import `chalk` elsewhere.
- Test errors by behavior, not wording: the exit code, the error's `code`, and
  that the hint names the command it points at.

## Writing messages people read

Errors, hints, notices, prompts, and help text are read by someone who is
stuck. Write them the way a person who knows the tool would say it out loud,
in short plain sentences. Full examples are in
[Writing messages](apps/cli/src/output/README.md#writing-messages).

- Say what happened in a few words: `Unknown flag -T`, `No record types
given`, `Can't read the shell history`.
- Then say what to do, in a sentence with the command in it: "Run `chronicle
auth login lastfm` to sign in." "Use `--limit 0` for all." "Did you mean
  `-t` (`--type`)?"
- State facts directly: "The default is submissions.", not "With none named,
  it reads only submissions".
- Use everyday verbs: run, use, pass, pick, sign in. Avoid words people don't
  say: "kinds you want", "read one", "name them", "proceed", "ensure",
  "utilize".
- Records are extracted, not read or fetched: "12 commits extracted".
- Don't describe the program ("it reads", "it asks which", "Chronicle will")
  or narrate yourself ("Extracting the following…").
- Don't join phrases with `·` or `→`, don't stack headings over commands
  ("See its kinds:"), and don't put a colon before everything.
- Commands are real and runnable as printed. Placeholders only for what the
  person alone knows (`--client-id <id>`).
- One or two sentences. If it needs more, it belongs in `--help` or the README.

Before committing a message, read it aloud. If it sounds like a form, a
manual, or a chatbot, rewrite it.

- Add a changeset (`npx changeset`) to pull requests that should ship in a release.
- Never check in planning or design docs. Keep plans in `.plans/`, which is
  git-ignored.
- Run `npm run quality` for code changes. Run `npm run packages:check` after
  package or dependency changes to verify installed tarballs.
- Do not co-author commits as coding agent
- Do not put a Claude session link in pull request descriptions.
