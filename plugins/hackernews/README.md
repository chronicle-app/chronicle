# @chronicle.app/hackernews

Read your Hacker News submissions, comments, and the replies to them through the public [Firebase API](https://github.com/HackerNews/API). No login is needed; `--username` is the only required flag, and the CLI asks for it when it's missing.

```sh
chronicle extract hackernews --username you
chronicle extract hackernews --type comments,replies --username you --since 2025-01-01
```

Each kind is one record type:

- `submissions` (the default): stories, polls, and job posts you submitted. Each becomes a `PublishAction` of a `Post` carrying the title as `name` and any text as `body`; a submitted link is an `Entity` in `references`, keyed by its URL alone, so it is the same node every source shares for that page.
- `comments`: comments you wrote. Each becomes a `RespondAction` whose `result` is the `Comment` and whose `object` is what it answers, a `Post` or another `Comment`.
- `replies`: other people's direct replies to your submissions and comments, in the same shape as `comments`, with the replier as the agent.

Every `Comment` is `about` the submission at the top of its thread, found by walking the `parent` chain; each item is fetched once per run, however many comments share it. For a top-level comment, the action's `object` and the comment's `about` are the same `Post`.

Every action is keyed by the Hacker News item id and timestamped with the item's post time. Accounts are `Agent`s keyed by `handle`, the username, which is the only identity Hacker News gives an account, with their profile page as `url`, and your own carries `sameAs: ['@me']` and your profile's about text. Comment and post text is converted from Hacker News HTML to plain text, with links kept as `label (url)`. Deleted items are skipped; dead (killed) items are kept.

Your items are read newest first, so `--since` ends the `submissions` and `comments` walks at the first older item. `replies` reads every item you posted, since an old item can get a new reply, and applies `--since` to the reply's own time.

Upvotes, favorites, and hidden items aren't read: Hacker News records no time for them.

Tests run the extractors against a fake Firebase API on 127.0.0.1. They never reach the network.
