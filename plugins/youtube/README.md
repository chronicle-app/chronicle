# Chronicle YouTube Plugin

Extract liked videos and channel subscriptions from YouTube via the Data API v3 with OAuth authentication.

## Features

- **Liked Videos**: Extract your liked videos (from the account's likes playlist, with like timestamps)
- **Subscriptions**: Extract your channel subscriptions (with subscribe timestamps)
- **Playlists**: Extract your own playlists and their videos (creation and item-add timestamps, privacy status)
- **Uploads**: Extract videos published to your own channel
- **OAuth Authentication**: Google OAuth 2.0 with offline refresh tokens

Watch and search history are not exposed by the Data API (Google Takeout only) and are out of scope for this plugin.

## Setup

### 1. Create Google OAuth credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create (or reuse) a project and enable the **YouTube Data API v3**
3. Create an OAuth client ID (web application)
4. Note your **Client ID** and **Client Secret**
5. Add Chronicle's callback to the authorized redirect URIs

### 2. Authenticate

```bash
chronicle auth login youtube --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

This opens your browser for Google consent and stores the tokens (including the offline refresh token) in Chronicle's credential store. Access tokens expire after an hour and are refreshed automatically.

### 3. Extract Data

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
- Subscription → `FollowAction` on the channel as an `Agent`, keyed on the channel id so re-runs supersede
- Playlist → `Collection` (with `visibility` from the privacy status), created via a `CreateAction` at the playlist's real creation time; each video in it → `AddAction` keyed on the playlist item id with the `Collection` as `targetCollection`
- Upload → `PublishAction` with the account owner as agent and the `VideoObject` as result
- Channels are `Agent`s keyed on their YouTube channel id

Tests run the pipeline against a fake Data API served on 127.0.0.1 with a fake
access token, and against a small synthetic Takeout folder in a temporary
directory. They never call Google, read stored credentials, or read the host's
data or accounts.
