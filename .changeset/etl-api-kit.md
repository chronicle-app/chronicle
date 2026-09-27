---
'@chronicle.app/etl': minor
---

Add the helpers that API sources use: `ApiProxy`, a base class for a source's HTTP client that maps 401 and 429 responses to `ApiAuthError` and `ApiRateLimitError`, and the `paginateOffset`, `paginateByPage`, and `paginateCursor` strategies. Add `htmlToText`, `htmlToMarkdown`, `decodeEntities`, `looksLikeHtml`, and `tokenizeHtml` for sources that store HTML as content.
