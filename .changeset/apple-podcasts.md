---
'@chronicle.app/apple-podcasts': minor
'@chronicle.app/schema': minor
---

Add the Apple Podcasts plugin, run as `chronicle extract apple-podcasts`. It extracts the episodes you played or saved in Podcasts on a Mac, and the shows you follow. A played episode is a `ListenAction`, and a finished one also a `CompleteAction`, dated when it was last played; a saved episode is a `BookmarkAction`; and a followed show is a `FollowAction`, dated when it was added to the library. Each is keyed by Apple's catalog ID for the episode or show, which is the same on each device, and an episode or show links to its page on Apple Podcasts and `references` the page its feed links it to, with you as its `agent`; what isn't in the catalog is left out, and the run says how many. The episode is a `PodcastEpisode` with its show as its `series`, when it was released as its `datePublished`, its audio file, its artwork, its description as Markdown, and its `transcript` when the app has downloaded one. The author a feed names for a show or an episode is its `author`, an `Agent` by that name, and a show's channel on Apple Podcasts is its `publisher`, keyed by the channel's catalog ID. Without an Apple Account signed in to the Mac, extraction stops and says to sign in. Each run is a snapshot, since the library keeps only each episode's latest state.

The vocabulary adds `PodcastSeries`, a podcast, with its `webFeed`, and `series`, the podcast an episode is part of.
