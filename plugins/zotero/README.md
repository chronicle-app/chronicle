# @chronicle.app/zotero

Chronicle plugin for a local [Zotero](https://www.zotero.org/) library: works
(references), the highlights and notes made on them, and standalone
attachments filed without a parent work.

## Installation

```bash
npm install @chronicle.app/zotero
```

## Usage

### Basic extraction

```bash
chronicle extract zotero
```

By default the plugin reads `~/Zotero`, Zotero's default data directory. Point
it elsewhere with `--input`, either the data directory itself or a path
directly to `zotero.sqlite`:

```bash
chronicle extract zotero --input /path/to/Zotero
chronicle extract zotero --input /path/to/Zotero/zotero.sqlite
```

### With date filtering

```bash
chronicle extract zotero \
  --input /path/to/Zotero \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

`--since`/`--until` filter on each item's own `dateModified`, so a filtered run
re-reports whatever changed (or was added) in that window, including edits to
older items.

## Configuration

The extractor supports the following options:

- `--input`: Path to the Zotero data directory, or directly to `zotero.sqlite`.
  Defaults to `~/Zotero`.
- `--since`: Extract records modified from this date onwards
- `--until`: Extract records modified up to this date
- `--limit`: Maximum number of records to extract, across all record types

## Source

The plugin opens `zotero.sqlite` read-only — it never writes to the library,
and never needs Zotero to be closed. It reads the **user library only**; group
libraries are out of scope. Trashed items (and anything whose parent is
trashed) are excluded throughout.

If Zotero is running, its exclusive lock on the database can make that
readonly open fail with `SQLITE_BUSY`; the extractor falls back to reading a
disposable filesystem-level clone of the (closed-journal, so consistent)
database file instead.

Every record carries the library's `localUserKey` (`settings.account`), stable
even for a library that has never synced to zotero.org.

## What it extracts

- **Works** (`recordType: work`) — top-level reference items (journal
  articles, books, book sections, preprints, …), each with its bibliographic
  fields (title, date, publisher, DOI, ISBN, …), creators, tag list, the
  collections it's filed under (with parent chains resolved), and its child
  attachments (with storage paths resolved to a file on disk where possible).
- **Annotations** (`recordType: annotation`) — highlights, underlines, notes,
  and other markup made in the Zotero reader (PDF or EPUB), with the
  annotated attachment and its parent work carried as context.
- **Attachments** (`recordType: attachment`) — standalone files saved
  directly to the library with no parent work, including their own tags and
  collection memberships.
- **Notes** (`recordType: note`) — Zotero note items, written on a work or
  standing alone, with the parent work carried as context and the HTML body
  passed through verbatim.

## Schema

The transformer maps these records onto Chronicle's schema: the catalog item
is the abstract work (`Book`, `Article`, `Post`, `VideoObject`, … by Zotero
item type, keyed by its item key so a re-typing refines in place), saved via a
`BookmarkAction` and carrying protocol `sameAs` edges (DOI with its resolver
url, ISBN, arXiv, PMID/PMCID — a bookSection's ISBN lands on its containing
book), creators, collections, and tags. Item keys are only per-library
unique, so every item-keyed identity is scoped by the library as an `inRealm`
Realm (the zotero.org userID when synced, else the local user key). A child
attachment is not a separate entity: it merges into its work via `sameAs` as
a sparse facet (mimeType, contentPath, its filesystem and content
identities — no name), entering the log through reading — each last-read
timestamp is a one-shot `ViewAction` (Zotero has no completion signal, so no
reading run is opened) whose object is the file facet, resolving to the
work. Annotations anchor to the facet too, so which copy a selector is valid
in survives beneath the merge. A carrier shared by two different works (one
anthology PDF under several items) withholds its merge edges so distinct
works never weld through a shared file; standalone attachments stay their
own entities. The file also
carries a filesystem-keyed `sameAs` (path scoped by machine, the timing/shell
convention), so app-tracked sessions on the same file fold onto it, and
`snapshotOf` the url hub for webpage snapshots. A highlight is a
`QuoteAction` → `Quotation` carrying a `PageSelector` (PDF) or
`EpubCfiSelector` (EPUB), and a note is an `AnnotateAction` → `Comment`
about the quotation.

## Tests

The tests build a synthetic Zotero data directory in a temporary folder: a
`zotero.sqlite` with only the tables the extractor reads, and a few files
under `storage/`. They stub the machine name, so they never read the host's
Zotero library, hostname, or accounts.
