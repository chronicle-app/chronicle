# @chronicle.app/twitter

Chronicle plugin for twitter

## Installation

```bash
npm install @chronicle.app/twitter
```

## Usage

The plugin reads your Twitter/X data two ways:

- **archive**: the data archive X sends you (Settings, then "Download an
  archive of your data"). It has your tweets, likes, and direct messages,
  and copies of their photos and videos.
- **api**: the X API, signed in as you. It has your tweets and retweets, your
  likes and bookmarks, with the time you liked or bookmarked each, which the
  archive doesn't have, and other people's tweets that mention you.

### From the archive

```bash
chronicle extract twitter --input /path/to/twitter-archive.zip
```

### From the API

The API needs an X developer app of your own, and X bills your developer
account for what you read.

1. Create an app in the [X developer console](https://console.x.com). In its
   user authentication settings, turn on OAuth 2.0, pick "Web App", and set
   the callback URL to `http://127.0.0.1:8789/callback`.
2. Sign in with the app's OAuth 2.0 client ID and secret:

   ```bash
   chronicle auth login twitter --client-id <id> --client-secret <secret> --port 8789
   ```

3. Extract:

   ```bash
   chronicle extract twitter --strategy api
   chronicle extract twitter likes --since 2025-01-01
   ```

### With date filtering

```bash
chronicle extract twitter \
  --input /path/to/twitter/export \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--strategy`: `archive` or `api`. A run with `--input` reads the archive;
  otherwise, once you've signed in, the API.
- `--input`: The Twitter/X archive, as a zip or its unzipped folder (needed for
  the archive)
- `--type`: Which record types to read. From the archive: `tweets`, `likes`,
  `direct-messages`, `group-direct-messages`. From the API: `tweets`, `likes`,
  `bookmarks`, `mentions`. The default is all of them.
- `--include-group-dms`: Include group direct messages (default: true)
- `--access-token`: An OAuth 2.0 user access token to use instead of the
  stored sign-in
- `--since`: Extract records from this date onwards. Likes and bookmarks from
  the API go by when you liked or bookmarked them.
- `--until`: Extract records up to this date
- `--limit`: Maximum number of records to extract

## The API

X's pay-per-use plan bills each post read from your own tweets, likes,
bookmarks, or mentions ($0.001 at the time of writing), once per post per
day. The author of a post you liked or bookmarked, or that mentions you, is
billed too ($0.010 an account, once a day), for their handle, which the
post's page is under. So is the post a retweet retweets ($0.005).

- **Tweets** go back no further than November 2010, and X returns only your
  most recent 3,200. The archive has the rest. A retweet comes with the post
  it retweets, looked up by its id.
- **Mentions** are other people's tweets that mention you, with who posted
  each. X returns only the most recent 800.
- **Likes** come most recently liked first, each with when you liked it.
  X doesn't say when, but its paging gives it away: each page's token holds
  the time of the last like on it, to the millisecond, and a token made for
  any moment returns the likes from before it.
  - One more request for each like in between starts a page where that like
    comes last, so most likes take about one request.
  - The newest few have nothing above them to start a page from. A search
    finds each to the second, halving the stretch it's in: a dozen or so
    requests for an hour, twenty for a week.
  - With `--since`, the search splits there first and leaves older likes
    alone. A poll with no new likes takes two requests.
  - X allows 75 requests every 15 minutes, about 300 likes an hour; past
    that, a run waits.
  - A like whose time can't be found has `likedDuring`, the stretch it's
    known to be in. Its action has the shortest UTC day, month, or year that
    holds it, such as `2026-11-07`.
- **Bookmarks** come one per request, each with the time you bookmarked it.
  A search finds the oldest, which no page ends on. X allows 180 requests
  every 15 minutes.

X doesn't document these times, so they may stop. Likes and bookmarks are
still extracted then, without them.

## Development

```bash
# Build the plugin
npm run build

# Run the tests
npm test
```

## File Format

The input is a Twitter/X data archive, zipped or unzipped. The plugin
reads these files from its `data/` folder, each a `window.YTD.<name>.part0 = [...]`
script wrapping a JSON array:

- `manifest.js`: when X generated the archive
- `account.js`: the archive owner's account ID, username, and display name
- `tweets.js`: your tweets
- `like.js`: the tweets you liked
- `direct-messages.js`: one-to-one direct messages
- `direct-messages-group.js`: group direct messages, with when each member
  joined or left

## Schema

- Each tweet is a `PublishAction` whose `result` is a `Post`, keyed by it.
  A post's `url` is its page as a browser has it,
  `https://x.com/<handle>/status/<id>`, when its author's handle is known:
  from the API, every post; from the archive, your own tweets, but not the
  ones you liked, as it names no author. An account's `url` is
  `https://x.com/<handle>`. The post's
  `references` are the accounts it mentions and the links it contains, and
  it's `about` a `Tag` for each hashtag, keyed by the hashtag in lowercase, as
  X matches them whatever their case. It `contains` an `ImageObject` for each
  photo and a `VideoObject` for each video or GIF, keyed by X's media id: the
  archive's copy of the file, or where X serves it. A liked or bookmarked post
  from the API has these too.
- A retweet from the API is a `ShareAction` of the post it retweets, keyed by
  the post and the account. The archive doesn't say which post a retweet was
  of, so its retweets stay tweets.
- A tweet that mentions you is its author's `PublishAction`, keyed by the
  tweet, the same as your own tweets.
- Each like is a `LikeAction` on the liked `Post`, and each bookmark a
  `BookmarkAction`, keyed by the post and the account, so a tweet liked from
  two accounts is two likes. From the API, it has the time you liked or bookmarked the
  post, when known, and the post has its author and their handle.
- Each direct message is a `MessageAction` whose `result` is a `Message`, keyed by it, sent to
  everyone else in the conversation when it was sent. In a group you joined,
  that's who was in it then, with later joins and leaves; in one you started,
  which says nothing of its start, it's you and everyone who wrote in it. It
  `contains` its photos and videos, from the archive's copies, keyed by their
  URLs.
- A tweet's or message's `body` is its text as written: X escapes it as HTML
  (`&amp;`, `&lt;`), and the escapes are undone.

The archive owner is an `Agent` linked to `@me`; other accounts are `Agent`s
keyed by their Twitter user ID.

Everything from an archive is asserted (`@assertedAt`) when X generated it,
from `data/manifest.js`: it's what X had then, an old tweet's author's handle
as much as a like. Each tweet and message keeps its place on the timeline by
its own time. A second import of the same archive restates what the first
did.

Tests build a small synthetic archive in a temporary directory, and serve a
synthetic X API locally. They never read the host's data or accounts.
