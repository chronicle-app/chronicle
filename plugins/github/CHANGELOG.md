# @chronicle.app/github

## 0.4.0

### Minor Changes

- 61ad43e: A GitHub plugin reads your pull requests, issues, commits, repositories, how issues and pull requests were resolved, comments, stars, and gists through the GitHub GraphQL API, plus other people's replies to you. An issue is a `Task` (opened with a `PlanAction`, closed with a `CompleteAction` or `CancelAction`); a pull request is a `Changeset` (opened with a `PublishAction`, merged with an `AcceptAction`, declined with a `RejectAction`, or withdrawn with a `CancelAction`). It signs in with `--token`, a token stored with `chronicle auth set github`, `GH_TOKEN`, `GITHUB_TOKEN`, or the gh CLI's login. A commit is a `Revision`, keyed by its hash across sources and `isBasedOn` its parents. The vocabulary adds `SoftwareSourceCode`, `Repository`, `Changeset`, `Revision`, `AcceptAction`, `RejectAction`, and `isBasedOn`.
- 32d4b05: Record kinds can follow the source (`chronicle extract github stars gists`), and kinds read by separate extractors now run together instead of failing as ambiguous: newest first when each extractor implements the new `occurredAt(record)` hook, one after another otherwise. `-t all` reads every kind, `-t defaults` the plugin's defaults. A plugin that declares no default kinds gets a picker on a bare run (space selects, enter starts, `a` all, `d` defaults), and outside a terminal an error saying how to name kinds; GitHub declares none. A run of several kinds says which it reads, and which it leaves out. The run summary puts the outcome on one line and a line per kind under it.

### Patch Changes

- Updated dependencies [a7fb44c]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/auth@0.4.0
