---
'@chronicle.app/github': minor
'@chronicle.app/schema': minor
---

A GitHub plugin reads your pull requests, issues, commits, repositories, how issues and pull requests were resolved, comments, stars, and gists through the GitHub GraphQL API, plus other people's replies to you. An issue is a `Task` (opened with a `PlanAction`, closed with a `CompleteAction` or `CancelAction`); a pull request is a `Changeset` (opened with a `PublishAction`, merged with an `AcceptAction`, declined with a `RejectAction`, or withdrawn with a `CancelAction`). It signs in with `--token`, a token stored with `chronicle auth set github`, `GH_TOKEN`, `GITHUB_TOKEN`, or the gh CLI's login. A commit is a `Revision`, keyed by its hash across sources and `isBasedOn` its parents. The vocabulary adds `SoftwareSourceCode`, `Repository`, `Changeset`, `Revision`, `AcceptAction`, `RejectAction`, and `isBasedOn`.
