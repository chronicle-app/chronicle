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

Run `chronicle sources` to list installed sources and `chronicle extract <source> --help`
for options. Bundled sources are `shell`, `claude-code`, `imessage`, and `things-todo`.

JSON is the default; use `--loader csv`, `yaml`, or `table`, and `--output <file>`
to write a file. The default limit is 100; `--limit 0` reads all records. Each run
reads the requested scope again without an archive or saved cursor.

Manage credentials with `chronicle auth`, settings with `chronicle config`, and
install additional plugins with `chronicle plugins install <package>`.
