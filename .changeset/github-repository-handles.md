---
'@chronicle.app/github': minor
---

GitHub repositories are keyed by their owner's login and their own name, the `owner/name` in their URL and git remotes, instead of by the owner's numeric id and the name. A repository's `handle` is its name. Issues, pull requests, and stars are keyed through their repository the same way. A repository now becomes a new node when its owner changes their login, as it already did when it was renamed or transferred. Repositories, issues, pull requests, and stars extracted before this change were keyed differently, so extracting them again makes new nodes.
