# Working on Chronicle

Chronicle extracts personal history into a shared vocabulary.

- Use TypeScript, ESM, npm workspaces, and Node.js 22.13+.
- Shared packages live in `core/`; source plugins live in `plugins/`.
- Use built-in `node:sqlite` for SQLite extraction and open source databases
  read-only.
- Keep the schema small. Add terms only when a plugin needs them. Edit
  `core/schema/chronicle.ttl`, then run `npm run schema:generate`; do not hand-edit
  generated schema code.
- Test behavior with synthetic files and databases. Keep personal data out of
  fixtures and logs.
- Add a changeset (`npx changeset`) to pull requests that should ship in a release.
- Run `npm run quality` for code changes. Run `npm run packages:check` after
  package or dependency changes to verify installed tarballs.
