# Plugin system

Status: proposed. This describes how the CLI finds, lists, installs, and
creates source plugins, and what a first run looks like.

## Goals

In priority order:

1. **A canonical list the maintainer controls.** One file in this repo says
   which sources are official, which ship with the CLI, and how ready each is.
2. **Friction-free plugins of your own.** Someone can write a plugin, often with
   a coding agent, and run it without publishing, building, or asking anyone.
3. **A good first run.** `npx @chronicle.app/cli` shows what works on this
   machine, and `extract shell` or `extract imessage` works in one step.
4. **A reasonable CLI.** Size and startup time matter less than the three goals
   above. Don't trade developer experience for megabytes.

## Where we are

- The CLI bundles all 29 plugins by depending on them. `PluginScanner` finds
  plugins in the workspace `plugins/` directory, the CLI's dependencies,
  oclif's installed plugins, and three `node_modules` directories, including
  the current directory's.
- Plugin metadata (sources, strategies, record types, descriptions) exists only
  as static fields on extractor classes, so listing a source means importing its
  plugin. Nothing records readiness, platform, requirements, or whether a
  plugin is legacy, and a plugin that isn't installed can't be listed.
- Every plugin carries an empty `"oclif": {}` so `chronicle plugins install`
  (oclif's `plugin-plugins`) accepts it. The CLI itself never reads it.
- Plugins handle `--limit`, `since`/`until`, counts, and credentials each in
  their own way. The ports turned up the same bugs in several of them:
  `--limit 0` returning nothing, `until` ignored, counts that ignore the date
  window, credential fields that `chronicle auth set` doesn't write.

## Two lists

- The **catalog** is a file in this repo that the maintainer edits. It is the
  canonical list of official plugins.
- The **local list** is per machine, in the user's Chronicle config. It holds
  plugins the user added with `chronicle plugins add`. Nobody else sees it.

The catalog decides what is recommended and installable by short name. It never
decides what may run: anything on the local list runs.

## The catalog

`catalog.json` at the repo root, shipped inside the CLI package:

```json
{
  "plugins": [
    {
      "name": "shell",
      "package": "@chronicle.app/shell",
      "tier": "core",
      "readiness": "shipped",
      "summary": "Shell command history (bash, zsh, fish)"
    },
    {
      "name": "google-reader",
      "package": "@chronicle.app/google-reader",
      "tier": "legacy",
      "readiness": "unverified",
      "summary": "Google Reader history from a Takeout export"
    }
  ]
}
```

Tiers:

| Tier       | Meaning                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| `core`     | Bundled with the CLI.                                                                   |
| `official` | In this repo, published, installed with `chronicle plugins install`.                    |
| `legacy`   | As `official`, for services that no longer exist. Hidden from `sources` unless `--all`. |
| `listed`   | A third-party package the maintainer has reviewed.                                      |

Readiness uses the existing vocabulary: `shipped`, `partial`, `planned`,
`unverified`.

What a plugin does lives in its own `package.json`, in the `chronicle` field,
so the plugin author controls it and the catalog only adds the maintainer's
judgement:

```json
"chronicle": {
  "plugin": true,
  "sources": {
    "imessage": {
      "ways": { "app-db": { "delivery": "local", "recordTypes": ["messages"] } },
      "platforms": ["darwin"],
      "requires": ["full-disk-access"]
    }
  }
}
```

Tests keep the two honest:

- Every plugin in `plugins/` has a catalog entry, and every catalog entry's
  package exists.
- Each plugin's `chronicle` manifest matches its exported extractor classes:
  same sources, ways in, deliveries, and record types.
- The CLI's dependencies are exactly the `core` tier.

The root README's sources table is generated from the catalog and manifests.

## Commands

### `chronicle sources`

Lists every catalog plugin except `legacy` (add `--all`), plus local plugins,
each marked installed, not installed, or local, with readiness and any
requirement this machine doesn't meet. `sources info <source>` shows the
manifest details. Listing reads manifests and doesn't import plugin code.

### `chronicle plugins install <name>`

Resolves a short name through the catalog and installs the package into the
user's Chronicle data directory with the user's own npm. A full package name or
path works too, and is reported as not in the catalog. `extract <source>` for a
catalog source that isn't installed says which command installs it.

### `chronicle plugins add <path>`

Adds a plugin at any location to the local list: a single file
(`./my-source.ts`) or a directory. It imports the plugin once, prints the
sources and ways in it found, fails clearly if there is no extractor, and saves
the absolute path. Nothing is copied, so edits take effect on the next run.
`plugins remove <name|path>` and `plugins list` go with it.

If a local plugin claims a source the catalog also has, the local one wins and
each run prints a one-line notice. That is the workflow for developing a fix to
an official plugin.

### `chronicle plugins new <name> [--dir <path>]`

Scaffolds a plugin that already runs, then adds it:

- `package.json` with the `chronicle` manifest
- an extractor and transformer that work on a bundled sample fixture
- a `node:test` pipeline test on that fixture
- `README.md`
- `AGENTS.md` for coding agents: the vocabulary and how to find terms, how
  records are keyed and validated, keeping tests off the host (no real data,
  contacts, accounts, or network), and how to run `plugins check`
- a tsconfig with `erasableSyntaxOnly` (see TypeScript below)

It prints the next steps: `chronicle extract <name> --preview` and
`chronicle plugins check <name>`.

Run inside a Chronicle checkout, it scaffolds into `plugins/<name>`, wires the
workspace and root tsconfig, and adds a catalog entry with tier `official` and
readiness `planned`. The same command serves outside authors and the
maintainer.

### `chronicle plugins check <name|path>`

Runs the conformance checks and schema validation against the plugin's
fixture:

- `--limit n` returns at most n records, and `--limit 0` means no limit
- `since` and `until` are both honoured, with the same bounds as the count
- `determineCount` respects the date window
- with explicit config, nothing reads host data or the network
- credentials come from `resolveCredentials` under the standard field names
- every payload validates against the schema

Failures say what to change. An unknown `@type` or property lists the nearest
vocabulary terms and links to the schema site's suggestion page. For a package
about to be published, it also reports `.ts` files that won't load from
`node_modules`.

The same checks run in this repo's CI for every plugin.

### `chronicle extract <source> --preview`

Prints the first few transformed records as readable text, for iterating on a
plugin. On a terminal, a short preview is also the default output of `extract`;
JSON stays the default when output is piped or `--output` is given.

## TypeScript without a build

Local plugins can be `.ts` and run directly:

- Node 22.18 and later strip types by default.
- Node 22.13 to 22.17 (the current floor) have it behind
  `--experimental-strip-types`. When `process.features.typescript` is off and a
  `.ts` plugin is needed, the CLI relaunches itself once with that flag and
  `--disable-warning=ExperimentalWarning`.

The Node floor stays at 22.13. Type stripping has limits the scaffold and
`AGENTS.md` follow:

- erasable syntax only: no `enum`, `namespace`, or constructor parameter
  properties
- relative imports use the `.ts` extension
- Node won't strip types under `node_modules`, so published plugins ship
  JavaScript

## Discovery

In order, first match per package name wins:

1. local list (`plugins add`)
2. the workspace `plugins/` directory, when running from a checkout
3. installed plugins in the Chronicle data directory
4. `core` plugins bundled with the CLI

The scan of the current directory's `node_modules` goes: running `chronicle`
inside an unrelated project shouldn't import that project's packages. With our
own install command, plugins drop `"oclif": {}` and the CLI drops
`@oclif/plugin-plugins`.

## First run

`chronicle` with no arguments on a fresh install:

- detects which sources work here: shell history files, the Messages database,
  Safari history, Things, Claude Code transcripts
- prints two or three commands that will work now, starting with
  `chronicle extract shell`
- lists sources that need a step first, with the step

When a source needs Full Disk Access (iMessage, Safari), a permission error
becomes an explanation: which app to add (Terminal, iTerm, VS Code, …), the
System Settings path, and the command to rerun.

`core` tier: shell, imessage, safari, things-todo, claude-code.

## Plan

1. Catalog, manifests, and their tests; `sources` reads them; README table
   generated. No behaviour change beyond listing.
2. `plugins install` by short name, `add`, `remove`, `list`; discovery order;
   un-bundle everything outside `core`; drop the oclif plugin commands and
   stanzas.
3. `plugins new` with the scaffold and `AGENTS.md`; TypeScript relaunch;
   `extract --preview`.
4. `plugins check` and the conformance checks in CI; fix the ported plugins
   until they pass.
5. First run: detection, Full Disk Access guidance, preview output by default.

## Open questions

- Should the catalog also be fetchable (a small package or URL), so it can
  change without a CLI release?
- Which plugins are `legacy`: Google Reader and Moves, and Marvin?
- Should `extract` on a terminal default to the preview, or keep JSON and make
  `--preview` opt-in?
