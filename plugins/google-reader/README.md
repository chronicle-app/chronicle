# @chronicle.app/google-reader

Import personal actions from an unpacked Google Reader archive containing raw Reader API stream responses. This is a Chronicle workspace plugin.

## Usage

From a built Chronicle checkout:

```bash
chronicle extract google-reader --input /path/to/reader-archive
chronicle extract google-reader --input /path/to/reader-archive \
  --since 2010-01-01 --until 2010-12-31 --limit 1000
```

`--input` is a directory with this layout:

```text
reader-archive/
  data/user-info.json
  _raw_data/www.google.com-reader-api-0-stream-contents-user-<id>-<stream>.json
```

Each stream JSON has an `items` array. Items carry `id`, `title`, a microsecond `timestampUsec` string, and `categories` such as `user/123/state/com.google/read`. Optional `alternate`, `content`/`summary`, and `annotations` supply article URLs, bodies, and notes. Other archive files are ignored; this plugin does not parse OPML, ZIP files, preferences, or separate friend-activity files.

The archive owner's ID comes from `user_id` in `data/user-info.json`; `user_name` and `email` provide optional profile details. Use `--user-id 123` to explicitly select your account, including when user info is missing. This also restricts stream filenames to that user. Only that account's states and annotations become actions, and only that account is linked to `@me`. When matching user info supplies an email, the owner also links to an `email` identity and a `google-account` identity, both keyed by that address, as Gmail, Google Calendar, and Chrome key you. These `sameAs` references resolve to the same entity on import; no email identity is inferred when the address is missing.

`--since` and `--until` are inclusive bounds on the item's `timestampUsec`. `--limit` caps matching raw items across all files, not generated actions; `0` means unlimited. Files are processed in filename order, not chronological order. Invalid stream JSON or item timestamps fail the extraction rather than silently dropping a file.

## Output

- `read` → `ReadAction`
- `broadcast` → `PublishAction`
- `starred` → `LikeAction`
- Owner annotations → `AnnotateAction` with a `Comment` result

Actions link the owner to an `Article`, identified by its Reader item ID even when its URL is missing. Annotations are distinguished by article, author, and text; identical notes by the same author on the same article deduplicate because the supported annotation format has no separate note ID. Raw records include the individual item and stream metadata, without repeating the full stream.

All actions on an item use its archive timestamp. Category state alone does not establish separate read, share, star, or annotation times; the output should not be interpreted as precise session timing.

## Development

```bash
npm run build -w @chronicle.app/google-reader
npm run test -w @chronicle.app/google-reader
npm run lint -w @chronicle.app/google-reader
npm run typecheck -w @chronicle.app/google-reader
```

Tests build small synthetic archives (a `user-info.json` and raw stream JSON files) in a temporary directory, run them through the extractor and transformer, and validate the output against the Chronicle schema. They never read the host's data or Google account and make no network requests.
