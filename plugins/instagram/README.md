# @chronicle.app/instagram

Chronicle plugin for instagram

## Installation

```bash
npm install @chronicle.app/instagram
```

## Usage

### Basic extraction

```bash
chronicle extract instagram --input /path/to/instagram/export
```

This reads your posts, the default. Pass `--type` with `stories`, `messages`, `likes`, `follows`, `saves`, `comments` or `searches` for the rest of the export.

### With date filtering

```bash
chronicle extract instagram \
  --type messages \
  --input /path/to/instagram/export \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--input` (required): Path to the Instagram export directory (the unzipped
  JSON data export)
- `--type`: The record type to extract, one per run: `posts`, `stories`,
  `messages`, `likes`, `follows`, `saves`, `comments` or `searches`. In a
  terminal, the CLI asks when it is left out.
- `--since`: Extract records from this date onwards
- `--until`: Extract records up to this date
- `--limit`: Maximum number of records to extract

## Development

```bash
# Build the plugin
npm run build -w @chronicle.app/instagram

# Run the tests
npm test -w @chronicle.app/instagram
```

## File Format

The input is an Instagram data export in JSON format, unzipped. The account
owner comes from
`personal_information/personal_information/personal_information.json`; an
export without a username fails rather than inventing one. Each record type
reads its own files:

| Type       | Files                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `posts`    | `your_instagram_activity/media/posts.json`, `posts_1.json`, `other_content.json`               |
| `stories`  | `your_instagram_activity/media/stories.json`                                                   |
| `messages` | `your_instagram_activity/messages/inbox/*/message_1.json`, `message_requests/*/message_1.json` |
| `likes`    | `your_instagram_activity/likes/liked_posts.json`, `story_interactions/story_likes.json`        |
| `follows`  | `connections/followers_and_following/following.json`, `followers_1.json`                       |
| `saves`    | `your_instagram_activity/saved/saved_collections.json`, `saved_posts.json`                     |
| `comments` | `your_instagram_activity/comments/post_comments_1.json`, `reels_comments.json`                 |
| `searches` | `logged_information/recent_searches/profile_searches.json`, `word_or_phrase_searches.json`     |

The extractors read the older `label_values` entries, the 2025
`string_map_data`/`string_list_data` entries (often wrapped in a single-key
object), and the 2026 bare lists. Text is repaired from the export's
byte-per-character mojibake. Media paths that point outside the export
directory are skipped.

## Schema

- `posts`, `stories`: a `PublishAction` of a `Post` that `contains` its
  `ImageObject`/`VideoObject` files, with a `sourceFormat` of `feed`, `reel`
  or `story`.
- `messages`: a `MessageAction` of a `Message`; a shared post, profile or link
  is in its `references`. Emoji reactions are `RespondAction`s with a
  `Response` result.
- `likes`: a `LikeAction` on another account's `Post`.
- `follows`: a `FollowAction` between your account and another `Agent`.
- `saves`: a `BookmarkAction` on a `Post`, with the `Collection` as `target`.
- `comments`: a `CreateAction` of a `Comment` that `references` the account
  whose post it was.
- `searches`: a `FindAction` on an `Agent` (a profile search) or a `Query`.

Tests build a small synthetic export in a temporary directory, with made-up
accounts, messages and media files, and run it through each extractor and the
transformer. They never read the host's Instagram data or accounts.
