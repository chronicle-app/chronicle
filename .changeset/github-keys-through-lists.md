---
'@chronicle.app/github': minor
---

A repository is keyed by its owner as well as its name, and an issue, a pull request, or a star by its repository's owner and name. Their keys named the owner and the repository through lists without `[*]`, so they read nothing: repositories with the same name were one node whoever owned them, as were issues and pull requests with the same number in different repositories, and stars of repositories with the same name. Repositories, issues, pull requests, and stars extracted before this change were keyed differently, so extracting them again makes new nodes.
