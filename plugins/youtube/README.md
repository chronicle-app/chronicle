# Chronicle YouTube Plugin

Extract liked videos and channel subscriptions from YouTube via the Data API v3 with OAuth authentication.

## Features

- **Liked Videos**: Extract your liked videos (from the account's likes playlist, with like timestamps)
- **Subscriptions**: Extract your channel subscriptions (with subscribe timestamps)
- **Playlists**: Extract your own playlists and their videos (creation and item-add timestamps, privacy status)
- **Uploads**: Extract videos published to your own channel
- **OAuth Authentication**: Google OAuth 2.0 with offline refresh tokens

Watch and search history aren't in the Data API. The `takeout` strategy reads
them, with the rest of the library, from a Google Takeout:

```bash
chronicle extract youtube --strategy takeout --input ~/Downloads/takeout-20260725T000000Z-001.zip
```

It takes the Takeout as a zip, one part of a split Takeout, the unzipped folder,
or its `YouTube and YouTube Music` folder, and reads a zip in place.
`chronicle scan <path>` finds a Takeout in a folder of exports. It reads history
in HTML, as Takeout writes it by default; a Takeout with its history in JSON
isn't read yet.

## Setup

### 1. Sign in with Google

YouTube signs in with the Google sign-in Gmail and Google Calendar use. Add YouTube to it:

```bash
chronicle auth login google --add youtube
```

This turns the YouTube Data API on in your Google Cloud project. The first time, it also walks you through making an OAuth client there, and asks for Gmail and Calendar too. See [`@chronicle.app/google`](../../core/google/README.md) for the steps. With several Google accounts signed in, pick one with `--account you@example.com`.

### 2. Extract Data

```bash
# Liked videos (default extraction type)
chronicle extract youtube --type likes

# Subscriptions
chronicle extract youtube --type subscriptions

# Playlists and uploads
chronicle extract youtube --type playlists
chronicle extract youtube --type uploads
```

## Data Mapping

- Liked video → `LikeAction` by the account owner (`@me`) on a `VideoObject` (title, description, duration, thumbnail, uploading channel as author)
- Subscription → `FollowAction` on the channel as an `Agent`, keyed by the channel it follows so re-runs supersede
- Playlist → `Collection` (with `visibility` from the privacy status), created via a `CreateAction` at the playlist's real creation time; each video in it → `AddAction` keyed on the playlist item id with the `Collection` as `targetCollection`
- Upload → `PublishAction` with the account owner as agent and the `VideoObject` as result
- Channels are `Agent`s keyed on their YouTube channel id

Tests run the pipeline against a fake Data API served on 127.0.0.1 with a fake
access token, and against a small synthetic Takeout, unzipped and zipped, in a
temporary directory. They never call Google, read stored credentials, or read the host's
data or accounts.
