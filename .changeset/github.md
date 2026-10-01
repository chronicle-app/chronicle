---
'@chronicle.app/github': minor
'@chronicle.app/schema': minor
---

A GitHub plugin reads your pull requests, issues, the issues you closed, comments, stars, and gists through the GitHub GraphQL API, plus other people's replies to you. An issue is a `Task`: opening it is a `PlanAction`, and closing it a `CompleteAction` or `CancelAction`. It signs in with `--token`, a token stored with `chronicle auth set github`, `GH_TOKEN`, `GITHUB_TOKEN`, or the gh CLI's login. The vocabulary adds `SoftwareSourceCode`, `Repository`, and `PullRequest`.
