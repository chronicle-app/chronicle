# @chronicle.app/github

Read your GitHub activity through the [GraphQL API](https://docs.github.com/en/graphql): the pull requests and issues you opened, your comments and reviews, the repositories you starred, your gists, and other people's replies to you.

## Usage

```sh
chronicle extract github
chronicle extract github --type stars
chronicle extract github --type replies --since 2025-01-01
```

Each kind is one record type. A bare run reads them all, merged newest first.

- `pull-requests`: pull requests you opened.
- `issues`: issues you opened.
- `comments`: your comments on issues and pull requests.
- `reviews`: pull request reviews you submitted, with their inline comments.
- `replies`: other people's comments and reviews on your issues and pull requests, replies in review threads you started, and on anyone else's issue or pull request, every comment after your first one there.
- `stars`: repositories you starred, dated when you starred them.
- `gists`: your gists, public and secret.

`--since` ends each walk once it passes older items. GitHub lists comments by when they were last edited, so `comments` stops at the first comment last edited before `--since` and keeps those written since then. `reviews` reads your contributions a year at a time, back to `--since` or to when the account was created. `replies` is the slowest kind: it walks every thread you opened, commented on, or started a review thread in, because an old thread can get a new reply, and skips only threads with no activity since `--since`. A bare run waits on it before yielding anything.

Activity in private repositories is included when the token can see it, marked `visibility: private`.

## Credentials

The first of these found is used, and the run says which:

1. `--token`.
2. A token stored with `chronicle auth set github`.
3. `GH_TOKEN`, then `GITHUB_TOKEN`.
4. The [gh CLI](https://cli.github.com)'s login, from `gh auth token`. The token is only held in memory for the run, so refreshing or revoking it in gh takes effect on the next run. `--no-gh` turns this off.

gh's default scopes (`repo`, `read:org`, `gist`) cover everything. For a personal access token, public activity needs no scopes, private repositories need `repo`, and secret gists need `gist`. A missing scope stops the run with the scope to add: for a gh login, `gh auth refresh -s <scope>`.

## Schema

| GitHub activity                    | Chronicle action | `object`                     | `result`                              |
| ---------------------------------- | ---------------- | ---------------------------- | ------------------------------------- |
| You opened a pull request or issue | `PublishAction`  | `PullRequest` or `Issue`     |                                       |
| You or someone else commented      | `RespondAction`  | the `Issue` or `PullRequest` | `Comment`                             |
| You or someone else reviewed       | `RespondAction`  | the `PullRequest`            | `Response` (verdict in `ratingValue`) |
| An inline comment in a review      | `RespondAction`  | the `PullRequest`            | `Comment`                             |
| You starred a repository           | `LikeAction`     | `Repository`                 |                                       |
| You created a gist                 | `PublishAction`  | `SoftwareSourceCode`         |                                       |

| GitHub thing            | Chronicle entity                          | Key                                           | Properties                                                                                                                                         |
| ----------------------- | ----------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | `Repository`                              | `@type`, `source`, `creator.sourceId`, `name` | `name` (without the owner), `url`, `description`, `references` (homepage), `programmingLanguage`, `tags` (topics), `creator` (owner), `visibility` |
| Pull request, issue     | `PullRequest`, `Issue`                    | `@type`, `source`, `sourceId`                 | `name` (title), `body`, `url`, `datePublished`, `author`, `isPartOf` (repository), `visibility`                                                    |
| Comment                 | `Comment`                                 | `@type`, `source`, `sourceId`                 | `body`, `url`, `author`, `about` (its issue or pull request), `visibility`; inline: `isPartOf` (review), `inReplyTo`                               |
| Review                  | `Response`                                | `@type`, `source`, `sourceId`                 | `ratingValue`, `body`, `url`, `author`, `about` (its pull request), `visibility`                                                                   |
| Gist                    | `SoftwareSourceCode`                      | `@type`, `source`, `sourceId`                 | `name`, `url`, `datePublished`, `author`, `programmingLanguage`, `visibility`                                                                      |
| User, organization, bot | `Person`, `Organization`, `SoftwareAgent` | `@type`, `source`, `sourceId`                 | `sourceId` (numeric id), `handle` (login), `name`, `url`                                                                                           |

### Decisions

**Accounts are keyed by their numeric id; a repository by its owner and name.** An account's `sourceId` is GitHub's numeric id, the one in `api.github.com/user/<id>`, which survives a change of login; its login is the `handle`. A repository is keyed through its owner, its `creator`, by the owner's numeric id and the repository's own `name` (`maloja` in `krateng/maloja`), so it stays one node when its owner changes their login. A renamed or transferred repository becomes a new node. A star is keyed the same way through its repository, since you can star a repository once.

**Everything else is keyed by its GitHub node id.** Comments on issues and inline review comments are numbered separately, so their numeric ids can collide; node ids can't. The plugin asks for GitHub's next-generation ids, which are stable: without that, old objects answer with legacy ids GitHub is migrating away from. An action and the thing it creates share a `sourceId` and differ by `@type`.

**A pull request is an `Issue`.** It's a `PullRequest`, a kind of `Issue`, as on GitHub, where every pull request is an issue with code attached. A comment on a pull request is on the pull request, not on the issue behind it, which GitHub gives an id of its own.

**A review is a `Response` rated with its verdict.** GitHub's `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, or `DISMISSED` is its `ratingValue`, verbatim, and its summary is the `body`. Each inline comment is a `Comment` of its own, `isPartOf` its review and `inReplyTo` the comment it answers in its thread. GitHub files every reply in a review thread as a review that only comments, so a review with no summary and no verdict gets no action; its inline comments still point at it.

**Replies stop at what's addressed to you.** On your own issues and pull requests, everything others wrote counts. Elsewhere, GitHub comments aren't threaded, so a comment counts as a reply when it comes after your first one on that issue or pull request. In review threads, which are threaded, only replies in threads you started count. Comments by deleted accounts are skipped.

**Merges and closes aren't read.** Which actions they should be is still open, and a pull request's current state changes after it's opened, which a record dated when it was opened can't say.

**Gists are `SoftwareSourceCode`; repositories are `Repository`, a kind of it.** A secret gist is hidden from listings but open to anyone with its URL, so it's `unlisted`, not `private`. A gist is named by its description, or its first file when it has none. An enterprise's internal repository is `private`.

**A repository's owner is its `creator`.** An owner publishes the repository but may not have written it, and it can change hands, so `author` isn't claimed.

## Tests

Tests run the extractors against a fake GitHub GraphQL API on 127.0.0.1 with synthetic data, a fake `gh` on `PATH`, and an empty credential store. They never reach the network or read your GitHub login.
