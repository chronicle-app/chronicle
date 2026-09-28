# @chronicle.app/arena

Chronicle plugin for [Are.na](https://www.are.na) — extracts your channels, the blocks you create and connect, your comments, and your follows. Built on the Are.na v3 REST API.

## Authentication

Create a [personal access token](https://www.are.na/developers/personal-access-tokens) with read-only access, then store it:

```bash
chronicle auth set arena
```

It prompts for the token and reuses it on later extractions. To use a token for a single run, pass `--access-token` instead.

Alternatively, authenticate with OAuth. Register an application at [Are.na OAuth settings](https://www.are.na/settings/oauth):

1. Set the **Redirect URI** to `http://127.0.0.1:7463/callback` — this is Chronicle's default OAuth callback (port 7463). Are.na validates the redirect URI exactly, so use `127.0.0.1` (not `localhost`) and match the port. If you run `chronicle auth` with a custom `--port`, register that port's callback instead.
2. Note the application's **Client ID** and **Client Secret**.

Then authenticate:

```bash
chronicle auth login arena --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

The resulting access token is stored locally and reused on subsequent extractions (the plugin requests read-only access).

## Usage

### Channels, blocks, and comments (default)

```bash
chronicle extract arena
```

Walks your channels and emits, for activity you performed:

- a `CreateAction` for each channel you created
- a `BookmarkAction` for each block (or sub-channel) you connected into a channel
- a `CreateAction` for each block you authored
- a `CreateAction` (→ `Comment`) for each comment you left on a block

Use `--since` for incremental extraction (channels untouched since then are skipped, and only activity after the date is emitted):

```bash
chronicle extract arena --since 2024-01-01
```

### Following

```bash
chronicle extract arena -t follows
```

Emits a `FollowAction` for every user, channel, and group you follow.

## Configuration

- `--access-token`: Are.na access token (overrides stored credentials)
- `--user-id`: Are.na user ID to extract for (defaults to the authenticated user)
- `--since`: only extract activity after this date (bookmarks extractor)
- `--limit`: maximum number of records to extract

## Schema

This plugin maps Are.na (v3) data onto the following Chronicle types:

| Are.na activity                              | Chronicle action | Object                                       |
| -------------------------------------------- | ---------------- | -------------------------------------------- |
| You created a channel                        | `CreateAction`   | `Collection`                                 |
| You connected a block/channel into a channel | `BookmarkAction` | `Post` / `Collection`                        |
| You authored a block                         | `CreateAction`   | `Post` (with `ImageObject` for image blocks) |
| You commented on a block                     | `CreateAction`   | `Comment` (linked to the block via `about`)  |
| You followed a user / channel / group        | `FollowAction`   | `Agent` / `Collection` / `Agent`             |

Users are represented as `Agent`, channels as `Collection`, and blocks as `Post`.

## Development

```bash
# Build the plugin
npm run build -w @chronicle.app/arena

# Typecheck, lint, and test
npm run typecheck -w @chronicle.app/arena
npm run lint -w @chronicle.app/arena
npm test -w @chronicle.app/arena
```

Tests run the extractors and transformer on synthetic Are.na API responses
served by an in-process stand-in for axios's HTTP adapter, with a fake access
token and a temporary `CHRONICLE_CONFIG_DIR` for stored credentials. They never
call Are.na or read the host's accounts or credentials.
