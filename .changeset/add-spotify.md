---
'@chronicle.app/spotify': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the Spotify plugin, bundled with the CLI. It reads recently played tracks, saved tracks and albums, and playlist entries through the Spotify Web API after `chronicle auth login spotify`, and emits a `ListenAction`, `LikeAction`, or `AddAction` for each. The vocabulary adds `ListenAction`, `LikeAction`, `AddAction`, `ReactAction`, `AssessAction`, `MusicRecording`, `MusicAlbum`, `MusicGroup`, `PerformingGroup`, and `PodcastEpisode`, with `artist`, `inAlbum`, `duration`, `genre`, `datePublished`, `emblem`, `target`, `width`, `height`, `performer`, `attribution`, `partOf`, and `composition`.
