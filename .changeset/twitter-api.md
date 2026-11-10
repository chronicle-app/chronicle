---
'@chronicle.app/twitter': minor
'@chronicle.app/etl': patch
---

Twitter reads your tweets, likes, and bookmarks through the X API, signed in as you: run `chronicle auth login twitter` with your X app's OAuth 2.0 client, then `chronicle extract twitter --strategy api`. Each like and bookmark has the time you liked or bookmarked it, which the archive doesn't have: to the millisecond for most, and to the second for the newest few likes. X doesn't document these times; they come from its paging. Most likes and bookmarks take one request each, the newest few likes a dozen or so, and a run with `--since` works only on what came after it, so a poll with nothing new takes two requests. A like or bookmark whose time can't be found has the stretch it's known to be in, and its action the shortest day, month, or year that holds it. Bookmarks are new: each is a `BookmarkAction` on the post.

From the API, `mentions` are other people's tweets that mention you, each its author's `PublishAction` with who posted it, and a retweet is your `ShareAction` of the post it retweets, looked up so the post has its text and author.

A tweet, and a direct message from the archive, `contains` its photos and videos: an `ImageObject` or `VideoObject` with the archive's copy of the file, or where X serves it.

A post has a `url`, its page as a browser has it (`https://x.com/<handle>/status/<id>`), when its author's handle is known: every post from the API, and your own tweets from the archive. To know the handle, reads of likes and bookmarks ask X who posted each post, which X bills ($0.010 an account, once a day), and the liked or bookmarked post has its author's handle and name. An account's `url` is now `https://x.com/<handle>` rather than `twitter.com`.

A tweet is `about` a `Tag` for each of its hashtags, keyed by the hashtag in lowercase, since X matches them whatever their case.

A like is now keyed by the account that liked it as well as the tweet, so a tweet liked from two accounts is two likes. Importing an archive into a store that already holds its likes adds new ones beside the old.

A run of an export that also has an API, such as Twitter's archive, no longer needs `--input` to read the API. Run without one, the export says `--input` is how to give it.
