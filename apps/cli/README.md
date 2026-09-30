# Chronicle CLI

Extract personal history into Chronicle JSON-LD. Requires Node.js 22.13 or newer.

## Getting started

Run the CLI without installing it:

```sh
npx @chronicle.app/cli@latest sources
npx @chronicle.app/cli@latest extract shell --limit 10
```

`@latest` makes npx check for a newer release instead of reusing its cached copy.
To install the `chronicle` command globally:

```sh
npm install -g @chronicle.app/cli
chronicle extract shell --limit 10
```

## Usage

Run `chronicle sources` to list sources and whether each is installed
(`--all` adds sources for services that no longer exist), and `chronicle extract <source> --help`
for options. The CLI bundles `shell`, `imessage`, `safari`, `things-todo`, and
`claude-code`; `chronicle plugins install <name>` adds any other catalog source.

JSON is the default; use `--loader csv`, `yaml`, or `table`, and `--output <file>`
to write a file. The default limit is 100; `--limit 0` reads all records. Each run
reads the requested scope again without an archive or saved cursor.

Manage credentials with `chronicle auth`, settings with `chronicle config`, and
plugins with `chronicle plugins`, `plugins install`, and `plugins uninstall`.
`plugins install` takes a catalog name, a package name, or a local path.

## Writing a plugin

`chronicle plugins new my-source` asks how the data reaches you (a CSV or JSON
file, an export folder, an app's SQLite database, a web API, or something else),
creates a plugin for it in `./my-source` on the matching base extractor, and
adds it. Its `AGENTS.md` lists what to fill in next and explains the vocabulary,
so you can follow it or point a coding agent at it.
`chronicle extract my-source --preview` prints a few records as text.

To run a plugin you're writing without installing it, use
`chronicle plugins add ./my-source` (its folder, with a package.json; a single file works too).
It runs from where it is, so edits apply on the next run, and it takes over any
source it provides, including an official one. `chronicle plugins remove` stops it.
Plugins can be TypeScript; they run without a build.
