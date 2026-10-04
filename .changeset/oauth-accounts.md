---
'@chronicle.app/auth': minor
'@chronicle.app/cli': minor
---

OAuth sign-in keeps one entry per account, and a token refresh updates the entry it read, where it used to overwrite the first one stored. Signing in again replaces your entry instead of adding another. Refresh uses the token URL saved at sign-in. `chronicle auth login` sends a `state` (and a PKCE challenge, for providers that use one) and checks the reply, no longer prints the tokens, takes `--client-file` and `--add`, and runs a provider's guided setup when it has one. `chronicle auth status` lists every signed-in account. A command that fails with a typed error keeps its exit code. Pressing Enter opens each page in the browser; a sign-in finished by hand doesn't wait for it. `--scopes` and `--add` can't be combined. `auth status` shows each account's expiry without refreshing it.
