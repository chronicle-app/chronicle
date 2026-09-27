# @chronicle.app/goodreads

Chronicle plugin for goodreads

## Installation

```bash
npm install @chronicle.app/goodreads
```

## Usage

### Basic extraction

```bash
chronicle extract goodreads --input /path/to/goodreads_library_export.csv
```

### With date filtering

```bash
chronicle extract goodreads \
  --input /path/to/goodreads_library_export.csv \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--input` (required): Path to the Goodreads library export CSV
- `--display-name`: Your name, used as the reading agent's display label
- `--user-id`: Your Goodreads review-list id — the `{id}-{slug}` (or bare numeric
  id) in your My Books URL, e.g. `1234567-pat-example`. Keys the user agent on
  the real id and gives each shelf its proper permalink; without it the agent and
  shelves fall back to name-based identity.
- `--since`: Extract records from this date onwards
- `--until`: Extract records up to this date
- `--limit`: Maximum number of records to extract

## File Format

The standard **Goodreads library export** CSV (Goodreads → _My Books_ → _Import
and export_ → _Export Library_). The first row is the header; the columns used
are `Book Id`, `Title`, `Author`, `Publisher`, `My Review`, `Bookshelves`,
`Date Added`, `Date Read`, and `Exclusive Shelf`. Other columns are read through
but not currently mapped.

The export is a re-read of your current shelf state, so the extractor declares
`temporality = 'snapshot'`: a book's mutable attributes (its review, the shelf
it sits on) are sighted at read time rather than back-dated to its add/read date,
so re-exporting after moving a book from _to-read_ to _read_ supersedes cleanly.

## Schema

Each row maps to a `Book` (keyed on the Goodreads `Book Id`) authored by a
`Person`, plus actions by the exporting user keyed off the row's shelf and dates:

| Goodreads row                     | Chronicle action | Notes                                             |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| Any book with a `Date Added`      | `BookmarkAction` | The "saved it" signal, placed at the add date     |
| `Exclusive Shelf` = `read`        | `CompleteAction` | Finish, placed at `Date Read` (falls back to add) |
| `currently-reading` / `to-finish` | `ConsumeAction`  | In-progress status, undated (no session start)    |

On the persistence side these fold into the derived `encountered` (every
bookmarked book), `completed` (finished books), and `consuming` (in-progress)
runs. The in-progress shelf is a status, not a reading session: Goodreads has no
start time, so the bare `ConsumeAction` opens the `consuming` run with an unknown
start, and a later finish closes it without asserting a reading interval.
`ReadAction` is reserved for sources that report real sessions.

The `Book` also carries metadata from the row: `My Review` → `description`,
`Author` plus `Additional Authors` → the `author` list (translators, co-authors),
`Publisher` → a name-keyed `Organization` on `publisher`, and `Number of Pages` →
`pageCount` (an edition-level count). When an `ISBN13` is present it becomes a
`sameAs` edge to the `isbn` namespace (a portable standard id), so the edition
collapses onto the same book read through any other ISBN-bearing source.

Each entry in `Bookshelves` becomes a `Collection` the book `isPartOf` — a shelf
is a real user-owned list, not a free-text tag. With `--user-id` set, the shelf
gets its true permalink (`…/review/list/{id}?shelf={name}`) and is keyed on that
url, so the same shelf merges across books and stays distinct across users;
without it, shelves are keyed on name. The exclusive shelf is dropped, since
reading state is already the actions above. Because the export is a snapshot,
removing a book from a shelf closes the membership on the next import.

The 1–5 `My Rating` is not yet mapped.

## Tests

Tests write a small synthetic library export CSV to a temp directory and run it
through the extractor and transformer, so they never read the host's Goodreads
data or accounts.
