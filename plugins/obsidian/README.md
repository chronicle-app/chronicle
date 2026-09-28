# @chronicle.app/obsidian

Import an Obsidian vault as Markdown documents, without requiring a particular
folder structure, tagging convention, person note, or custom properties.

## Usage

```bash
chronicle extract obsidian --input /path/to/vault
chronicle extract obsidian --input /path/to/vault/Books --limit 1
```

`--input` accepts a vault or a folder within it. The nearest ancestor containing
`.obsidian` supplies the vault name and relative paths, so a subfolder import
uses the same document identities as a full import. Without `.obsidian`, the
input directory is treated as the vault. `--limit` limits emitted notes (`0`
means unlimited); all vault note paths remain available for link resolution.

## Imported data

Every `.md` file is imported as a `DocumentObject`, including untagged notes.
Hidden files/directories, symlinks, and non-Markdown attachments are skipped.

- Identity: `(source, handle, inRealm.handle)`, where `handle` is the complete
  vault-relative filename and the realm handle is the vault folder name.
- Name: filename without its extension.
- Body: Markdown with leading YAML frontmatter omitted; other content, including
  Dataview syntax and whitespace, is preserved.
- Tags: the standard frontmatter `tags` property, preserving case and nested tags.
- References: resolved wikilinks and inline Markdown links to other notes;
  external HTTP(S) Markdown links reference URL entities.
- Modification: one `UpdateAction` at the file's modification time, attributed to
  the Chronicle owner through `@me`. No owner note is needed.

Wikilinks and note embeds support folder paths, display labels, headings and block anchors.
Relative Markdown note links are resolved against the source note's directory.
Repeated links are deduplicated. Unresolved or ambiguous targets stay in the
body without inventing a document. Code examples and comments are ignored when
recognizing links. This v1 does not parse the entire Markdown grammar: reference
style links, inline hashtags, and attachment contents remain in the body only.

Custom properties such as `type`, `birthday`, `goodreads_id`, or `letterboxd_url`
remain in the raw extraction metadata, outside the document body. They do not create people,
books, `sameAs` edges, or real-world actions. Aliases, including `@me`, do not
change a document's identity. There is no mapping configuration.

Filesystem birth time, when available, is retained in the raw record as
`birthtime`. It is not treated as an authored `CreateAction`: copying/restoring
a file can change it. Modification time records the current file state, not a
reconstructed history of every edit. Unchanged files have a deterministic
snapshot time based on the newest imported file modification time.

Notes are extracted newest-modified first, reading each body only when it is
emitted. Reruns scan every note: an already-imported path may still contain
edits, so the key-only ETL frontier cannot safely stop the scan. Complete,
unlimited scans also allow deleted notes to be detected.

The plugin provides `obsidian://open?vault=…&file=…` deep links from document
identities. Renaming a file changes its path identity; this v1 does not track
renames. Vaults with the same folder name share the same realm namespace.

## Development

```bash
npm test --workspace=@chronicle.app/obsidian
npm run build --workspace=@chronicle.app/obsidian
```

Tests build a small synthetic vault in a temporary directory and run it through
the extractor and transformer, so they never read a real vault or other host
data.
