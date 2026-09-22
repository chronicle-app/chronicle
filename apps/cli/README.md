# Chronicle CLI

Extract personal history with `chronicle extract <source>`. Run `chronicle sources`
to list installed sources and `chronicle extract <source> --help` for options.

JSON is the default; use `--loader csv`, `yaml`, or `table`, and `--output <file>`
to write a file. The default limit is 100; `--limit 0` reads all records. Each run
reads the requested scope again without an archive or saved cursor.

Manage credentials with `chronicle auth`, settings with `chronicle config`, and
install additional plugins with `chronicle plugins install <package>`.
Requires Node.js 22.13 or newer.
