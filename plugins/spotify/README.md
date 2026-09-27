# Chronicle Spotify Plugin

Extract listening history, saved tracks, and playlists from Spotify using OAuth authentication.

## Features

- **Recently Played**: Extract your recent listening history
- **Saved Tracks**: Extract your liked/saved tracks
- **Saved Albums**: Extract your saved/liked albums
- **Playlists**: Extract your playlists and their metadata
- **OAuth Authentication**: Secure authentication via Spotify OAuth 2.0

## Setup

### 1. Create Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Note your **Client ID** and **Client Secret**
4. Add `http://127.0.0.1:7463/callback` to your app's redirect URIs (use 127.0.0.1 for Spotify's OAuth validation, port 7463 is Chronicle's default)

### 2. Authenticate

Run the OAuth flow to get an access token:

```bash
chronicle auth login spotify --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

This will open your browser to authenticate with Spotify and store your access token.

### 3. Extract Data

Chronicle automatically uses your stored credentials and reads every record type unless you pass `--type`:

```bash
chronicle extract spotify
```

You can also manually provide a token:

```bash
chronicle extract spotify --access-token YOUR_ACCESS_TOKEN
```

## Credential Management

Chronicle stores your OAuth credentials in `~/.config/chronicle/credentials.json` for easy access. You can manage them with:

```bash
# Check stored credentials
chronicle auth list

# Check status of Spotify credentials
chronicle auth status spotify

# Remove stored credentials (requires re-authentication)
chronicle auth remove spotify
```

## Configuration Options

- `--access-token` (optional): OAuth access token (auto-retrieved from secure storage if not provided)
- `--limit` (default: 100): Limit the number of records extracted (use 0 for no limit)
- `--since` (optional): Extract records since this date
- `--until` (optional): Extract records until this date

## Example Usage

```bash
# Extract every record type
chronicle extract spotify

# Extract one record type
chronicle extract spotify --type listens

# Extract with limits and date ranges
chronicle extract spotify --limit 50
chronicle extract spotify --since 2024-01-01
chronicle extract spotify --until 2024-12-31

# Use a specific access token (overrides stored credentials)
chronicle extract spotify --access-token YOUR_TOKEN
```

## Data Types

The plugin extracts the following record types and transforms them into Chronicle actions:

- `listen` → `ListenAction`: Tracks you've recently listened to
- `like` → `LikeAction`: Tracks and albums you've saved/liked
- `playlist-track` → `AddAction`: Tracks added to your playlists

## Spotify API Scopes

The plugin requests these OAuth scopes:

- `user-read-recently-played`: Access recently played tracks
- `user-library-read`: Access saved tracks and albums
- `playlist-read-private`: Access private playlists
- `playlist-read-collaborative`: Access collaborative playlists

## Tests

The tests run each extractor and the transformer against synthetic Spotify API
responses served from a local HTTP server on 127.0.0.1, with a fake access token
passed in the config. They never call Spotify or read stored credentials.
