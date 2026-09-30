---
'@chronicle.app/github': minor
'@chronicle.app/schema': minor
---

A GitHub plugin reads your pull requests, issues, comments, reviews, stars, and gists through the GitHub GraphQL API, plus other people's replies to you. It signs in with `--token`, a token stored with `chronicle auth set github`, `GH_TOKEN`, `GITHUB_TOKEN`, or the gh CLI's login. The vocabulary adds `SoftwareSourceCode`, `Repository`, `Issue`, `PullRequest`, `programmingLanguage`, and `ratingValue`, and `inReplyTo` now applies to a `Comment`.
