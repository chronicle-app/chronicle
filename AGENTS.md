# Working on Chronicle

Chronicle extracts personal history into a shared vocabulary.

- Use TypeScript, ESM, npm workspaces, and Node.js 22.13+.
- Shared packages live in `core/`; source plugins live in `plugins/`.
- Use built-in `node:sqlite` for SQLite extraction and open source databases
  read-only.
- Keep the schema small. Add terms only when a plugin needs them. Edit
  `core/schema/chronicle.ttl`, then run `npm run schema:generate`; do not hand-edit
  generated schema code.
- Prefer a few integration tests over many unit tests. Test through the
  highest practical boundary: the CLI, a plugin's full pipeline, or a script
  run as a process. Use synthetic files and databases, and keep personal data
  out of fixtures and logs.
- Add a unit test only for logic that is hard to reach from outside, such as
  parsing edge cases or retry loops. Don't test what a nearby integration test
  already covers, or what Node or a library already guarantees.
- When changing behavior, extend an existing test before adding a new one.
- Add a changeset (`npx changeset`) to pull requests that should ship in a release.
- Run `npm run quality` for code changes. Run `npm run packages:check` after
  package or dependency changes to verify installed tarballs.
- Do not co-author commits as coding agent
