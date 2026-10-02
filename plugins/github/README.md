# @chronicle.app/github

Read your GitHub activity through the [GraphQL API](https://docs.github.com/en/graphql): the pull requests and issues you opened, how issues and pull requests were resolved, your comments, the repositories you starred, your gists, and other people's replies to you.

## Usage

```sh
chronicle extract github
chronicle extract github --type stars
chronicle extract github --type replies --since 2025-01-01
```

Each kind is one record type. A bare run reads your own activity, merged newest first: every kind but `replies` and `resolutions`, which are slow and run only when asked for with `--type`.

- `pull-requests`: pull requests you opened.
- `issues`: issues you opened.
- `comments`: your comments on issues and pull requests.
- `resolutions`: issues and pull requests you closed or merged, among your own and those in repositories you own, and what became of your pull requests, whoever decided it.
- `replies`: other people's comments on your issues and pull requests, and on anyone else's issue or pull request, every comment after your first one there.
- `stars`: repositories you starred, dated when you starred them.
- `gists`: your gists, public and secret.

`--since` ends each walk once it passes older items. GitHub lists comments by when they were last edited, so `comments` stops at the first comment last edited before `--since` and keeps those written since then. `resolutions` walks closed issues and pull requests, most recently active first, and stops at the first quiet since `--since`; without it, it reads every closed issue in every repository you own, which takes a while (about a minute and a half for 64 repositories). `replies` is the slowest kind: it walks every thread you opened or commented on, because an old thread can get a new reply, and skips only threads with no activity since `--since`.

Activity in private repositories is included when the token can see it, marked `visibility: private`.

## Credentials

The first of these found is used, and the run says which:

1. `--token`.
2. A token stored with `chronicle auth set github`.
3. `GH_TOKEN`, then `GITHUB_TOKEN`.
4. The [gh CLI](https://cli.github.com)'s login, from `gh auth token`. The token is only held in memory for the run, so refreshing or revoking it in gh takes effect on the next run. `--no-gh` turns this off.

gh's default scopes (`repo`, `read:org`, `gist`) cover everything. For a personal access token, public activity needs no scopes, private repositories need `repo`, and secret gists need `gist`. A missing scope stops the run with the scope to add: for a gh login, `gh auth refresh -s <scope>`.

## Schema

| GitHub activity                                    | Chronicle action                  | `object`                  | Other                      |
| -------------------------------------------------- | --------------------------------- | ------------------------- | -------------------------- |
| You opened an issue                                | `PlanAction`                      | `Task`                    |                            |
| You opened a pull request                          | `OfferAction`                     | `Changeset`               | `target`: the `Repository` |
| You or someone else commented                      | `RespondAction`                   | the `Task` or `Changeset` | `result`: the `Comment`    |
| An issue was closed as completed / not planned     | `CompleteAction` / `CancelAction` | `Task`                    |                            |
| A pull request was merged                          | `AcceptAction`                    | `Changeset`               |                            |
| A pull request was closed unmerged by someone else | `RejectAction`                    | `Changeset`               |                            |
| A pull request was closed unmerged by its author   | `CancelAction`                    | `Changeset`               |                            |
| You starred a repository                           | `LikeAction`                      | `Repository`              |                            |
| You created a gist                                 | `PublishAction`                   | `SoftwareSourceCode`      |                            |

| GitHub thing            | Chronicle entity                          | Key                                           | Properties                                                                                                                  |
| ----------------------- | ----------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Repository              | `Repository`                              | `@type`, `source`, `creator.sourceId`, `name` | `name` (without the owner), `url`, `description`, `references` (homepage), `tags` (topics), `creator` (owner), `visibility` |
| Issue                   | `Task`                                    | `@type`, `source`, `sourceId`                 | `name` (title), `body`, `url`, `isPartOf` (repository)                                                                      |
| Pull request            | `Changeset`                               | `@type`, `source`, `sourceId`                 | `name` (title), `body`, `url`, `datePublished`, `author`, `isPartOf` (repository), `visibility`                             |
| Comment                 | `Comment`                                 | `@type`, `source`, `sourceId`                 | `body`, `url`, `author`, `about` (its `Task` or `Changeset`), `visibility`                                                  |
| Gist                    | `SoftwareSourceCode`                      | `@type`, `source`, `sourceId`                 | `name`, `url`, `datePublished`, `author`, `visibility`                                                                      |
| User, organization, bot | `Person`, `Organization`, `SoftwareAgent` | `@type`, `source`, `sourceId`                 | `sourceId` (numeric id), `handle` (login), `name`, `url`                                                                    |

`SHAPES.md` sketches every record type's output, generated from the tests.

### Decisions

**Accounts are keyed by their numeric id; a repository by its owner and name.** An account's `sourceId` is GitHub's numeric id, the one in `api.github.com/user/<id>`, which survives a change of login; its login is the `handle`. A repository is keyed through its owner, its `creator`, by the owner's numeric id and the repository's own `name` (`maloja` in `krateng/maloja`), so it stays one node when its owner changes their login. A renamed or transferred repository becomes a new node. A star is keyed the same way through its repository, since you can star a repository once.

**Everything else is keyed by its GitHub node id.** Issues, pull requests, comments, and closings are numbered separately, so their numeric ids can collide; node ids can't. The plugin asks for GitHub's next-generation ids, which are stable: without that, old objects answer with legacy ids GitHub is migrating away from. An action and the thing it creates share a `sourceId` and differ by `@type`.

**An issue is a `Task`.** An issue is work to be done, filed against a repository, as a to-do item is filed in a project, so it's a `Task` that `isPartOf` its `Repository`, and its life follows a to-do's: opening it is a `PlanAction`, closing it as completed a `CompleteAction`, and closing it as not planned or a duplicate a `CancelAction`. A close from before GitHub recorded reasons counts as completed, as GitHub shows it. A task isn't a creative work, so who filed it is the agent of its `PlanAction`, and it carries no `author` or `visibility` of its own. A comment on a pull request is on the pull request, not on the issue GitHub keeps behind it.

**A pull request is a `Changeset`.** It's a set of changes to its repository, put forward as a unit and revised until it's decided, and it's neither an issue nor a commit: an issue asks for work, a commit is a point in the repository's history, and a pull request offers changes for its maintainers to take in or not. What became of it is told by the actions on it, not a stored state: opening it is an `OfferAction` with the repository as `target`, merging it an `AcceptAction`, and closing it unmerged a `RejectAction`, or a `CancelAction` when its own author withdrew it. GitHub records a merge as a close too; that close adds nothing.

**Resolutions are yours, or of your pull requests.** `resolutions` reads closed issues and pull requests among your own and those in repositories you own. It keeps the ones you resolved, and every resolution of a pull request you opened, since "my pull request was merged" is someone else's action on your work. Someone else closing an issue isn't. An issue closed, reopened, and closed again is closed twice.

**Replies stop at what's addressed to you.** On your own issues and pull requests, everything others wrote counts. Elsewhere, GitHub comments aren't threaded, so a comment counts as a reply when it comes after your first one on that issue or pull request. Comments by deleted accounts are skipped.

**Reviews aren't read.** A pull request review, its verdict, and its inline comments on the code aren't imported; conversation comments on a pull request are.

**Gists are `SoftwareSourceCode`; repositories are `Repository`.** A repository is a version-controlled store of files and their history, whatever it holds (code, data, documents), so it isn't a kind of source code; a gist is a snippet of code. A secret gist is hidden from listings but open to anyone with its URL, so it's `unlisted`, not `private`. A gist is named by its description, or its first file when it has none. An enterprise's internal repository is `private`.

**A repository's owner is its `creator`.** An owner publishes the repository but may not have written it, and it can change hands, so `author` isn't claimed.

## Tests

Tests run the extractors against a fake GitHub GraphQL API on 127.0.0.1 with synthetic data, a fake `gh` on `PATH`, and an empty credential store. They never reach the network or read your GitHub login.
