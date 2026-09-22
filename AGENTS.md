# Working on Chronicle

Chronicle extracts personal history into a shared vocabulary. Treat this as a
greenfield, extraction-first project. Reuse useful code from
`../chronicle-internal`, but choose designs and dependencies for this project.

- Use TypeScript, ESM, npm workspaces, and Node.js 22.13+.
- Shared packages live in `core/`; source plugins live in `plugins/`.
- Use built-in `node:sqlite` for SQLite extraction and open source databases
  read-only.
- Keep the schema small. Add terms only when a plugin needs them. Edit
  `core/schema/schema.ttl`, then run `npm run schema:generate`; do not hand-edit
  generated schema code.
- Test behavior with synthetic files and databases. Keep personal data out of
  fixtures and logs.
- Run `npm run quality` for code changes. Run `npm run packages:check` after
  package or dependency changes to verify installed tarballs.
