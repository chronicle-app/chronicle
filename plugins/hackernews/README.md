# @chronicle.app/hackernews

Read your Hacker News submissions, comments, and the replies to them through the public [Firebase API](https://github.com/HackerNews/API). No login is needed; `--username` is the only required flag, and the CLI asks for it when it's missing.

## Usage

```sh
chronicle extract hackernews --username you
chronicle extract hackernews --type comments,replies --username you --since 2025-01-01
```

Each kind is one record type:

- `submissions` (the default): stories, polls, and job posts you submitted.
- `comments`: comments you wrote.
- `replies`: other people's direct replies to your submissions and comments. Your own replies are under `comments`.

Your items are read newest first, so `--since` ends the `submissions` and `comments` walks at the first older item. `replies` reads every item you posted, since an old item can get a new reply, and applies `--since` to the reply's own time. Deleted items are skipped, as are removed ones the API returns with no time or text; dead (killed) items are kept, since they were still posted.

Upvotes, favorites, and hidden items aren't read: Hacker News records no time for them, and upvotes also need a login and page scraping.

## Schema

| Hacker News activity                    | Chronicle action | `object`                       | `result`  |
| --------------------------------------- | ---------------- | ------------------------------ | --------- |
| You submitted a story, poll, or job     | `PublishAction`  | `Post`                         |           |
| You commented                           | `RespondAction`  | the parent `Post` or `Comment` | `Comment` |
| Someone replied to your post or comment | `RespondAction`  | your `Post` or `Comment`       | `Comment` |

| Hacker News thing   | Chronicle entity | Key                           | Properties                                                               |
| ------------------- | ---------------- | ----------------------------- | ------------------------------------------------------------------------ |
| Story, poll, or job | `Post`           | `@type`, `source`, `sourceId` | `name` (title), `body` (text), `url` (item page), `author`, `references` |
| Comment             | `Comment`        | `@type`, `source`, `sourceId` | `body`, `url` (item page), `author`, `about`                             |
| Submitted link      | `Entity`         | `url`                         | `url`                                                                    |
| Account             | `Agent`          | `@type`, `source`, `handle`   | `handle`, `url` (profile page), `description` (yours only)               |

### Decisions

**A comment is a `RespondAction`, not a `CreateAction`.** The schema defines a comment as a prose `Response`, the `result` of a `RespondAction` whose `object` is what it responds to. A reply by someone else is the same shape with a different agent, so `comments` and `replies` share one transform.

**Two edges from a comment: `object` for its parent, `about` for its submission.** Hacker News gives each comment only its direct `parent`, which may be another comment. The action's `object` is that parent, preserving the thread's tree. The `Comment` is also `about` the story or poll at the top of the thread, found by walking `parent` links, so a reply deep in a discussion still links to what the discussion is about. YouTube and Are.na comments are likewise `about` their video or block. For a top-level comment, the two edges point at the same `Post`. Each item is fetched once per run, however many comments share it as an ancestor.

**The submitted link is in `references`, not `about`.** The schema reserves `about` for subject matter, such as topics and tags, and defines `references` as a link from one resource to another. A link submission is a post pointing at a page, as Are.na's link blocks are. Keeping `about` for "the submission this comment's thread is on" also keeps that edge unambiguous.

**The link is the shared page node.** It's an `Entity` keyed by `url` alone, with no `source`, so it is the same node that Safari, Are.na, and Obsidian produce for that page. Pinboard instead keys its page nodes by `url` and `source`, joining this one through their `url`, because its snapshots clear per-source notes and tags; Hacker News asserts no such state about the page.

**`author` is set on every `Post` and `Comment`.** Parent comments, the story at the top of a thread, and the item a reply answers have no action of their own in these records, so `author` is the only edge to whoever wrote them. It's set on your own items too, so a post has the same shape wherever it appears. It sits on the Hacker News `Post`, never on the linked page: the submitter wrote the submission, not the article.

**Accounts are keyed by `handle`.** A username is the only identity Hacker News gives an account; there is no separate numeric id, so there is no `sourceId`. Every `Agent` carries its profile page, `https://news.ycombinator.com/user?id=<username>`, as `url`. Yours also carries `sameAs: ['@me']` and your profile's about text as `description`.

**Items are keyed by their Hacker News id.** Stories, comments, and polls share one id sequence, so the id alone identifies an item. An action and its `Post` or `Comment` share that `sourceId` and differ by `@type`.

**Times are the item's post time.** Every action's `timestamp` is the item's `time`, exact to the second. Nothing is dated by when it was read.

**Text is plain.** Hacker News sends comment and post text as HTML. It's converted to plain text, with each `<p>` starting a new line and links kept as `label (url)`.

## Tests

Tests run the extractors against a fake Firebase API on 127.0.0.1 with synthetic items. They never reach the network.
