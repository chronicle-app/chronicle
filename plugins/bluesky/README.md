# @chronicle.app/bluesky

Read your Bluesky follows, followers, and likes through the atproto API.

```sh
chronicle extract bluesky --type follows --handle you.bsky.social --password <app-password>
chronicle extract bluesky followers likes --handle you.bsky.social --access-token <token>
```

The extractor resolves the handle to a DID, looks up the account's PDS in the PLC directory, and logs in with the password unless `--access-token` is given. `--handle` and `--password` fall back to the `handle`/`clientId` and `password`/`clientSecret` fields of the stored `bluesky` credentials. Use an app password rather than your account password.

Each kind is one record type:

- `follows` (the default): accounts you follow. Each becomes a `FollowAction` from you to the account.
- `followers`: accounts that follow you. Each becomes a `FollowAction` from the account to you.
- `likes`: posts you liked. Each becomes a `LikeAction` on the `Post`, plus a `PublishAction` by the post's author at the time the post was written.

Every action is keyed by its atproto record (`did:…/collection/rkey`) and timestamped with the record's `createdAt`, fetched from the repository for each item. Accounts are `Agent`s keyed by their DID, and your own account carries `sameAs: ['@me']`. A post's images become `ImageObject`s in `contains`, keyed by URL, with the image size and alt text when present.

Tests run the extractors against a fake Bluesky server on 127.0.0.1, with explicit handle and password or token and an empty credential directory. They never reach the network or read the host's stored credentials.
