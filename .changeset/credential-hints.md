---
'@chronicle.app/auth': patch
'@chronicle.app/lastfm': patch
'@chronicle.app/foursquare': patch
---

A missing stored credential now points at `chronicle auth set <source>`, the command that stores static tokens, instead of `chronicle auth login`, which only OAuth sources support. Last.fm and Foursquare, which sign in with OAuth, still point at `auth login`.
