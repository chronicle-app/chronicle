---
'@chronicle.app/twitter': minor
'@chronicle.app/etl': patch
'@chronicle.app/schema': minor
---

Twitter reads your tweets, likes, and bookmarks through the X API, signed in as you: run `chronicle auth login twitter` with your X app's OAuth 2.0 client, then `chronicle extract twitter --strategy api`. Each like and bookmark has the time you liked or bookmarked it, which the archive doesn't have: to the millisecond for most, and to the second for the newest few likes. X doesn't document these times; they come from its paging. Most likes and bookmarks take one request each, the newest few likes a dozen or so, and a run with `--since` works only on what came after it, so a poll with nothing new takes two requests. A like or bookmark whose time can't be found has the stretch it's known to be in, and its action the shortest day, month, or year that holds it. Bookmarks are new: each is a `BookmarkAction` on the post.

From the API, `mentions` are other people's tweets that mention you, each its author's `PublishAction` with who posted it, and a retweet is your `ShareAction` of the post it retweets, looked up so the post has its text and author.

A tweet, and a direct message from the archive, `contains` its photos and videos: an `ImageObject` or `VideoObject` with the archive's copy of the file, or where X serves it.

A post has a `url`, its page as a browser has it (`https://x.com/<handle>/status/<id>`), when its author's handle is known: every post from the API, and your own tweets from the archive. To know the handle, reads of likes and bookmarks ask X who posted each post, which X bills ($0.010 an account, once a day), and the liked or bookmarked post has its author's handle and name. An account's `url` is now `https://x.com/<handle>` rather than `twitter.com`.

A tweet is `about` a `Tag` for each of its hashtags, keyed by the hashtag in lowercase, since X matches them whatever their case.

A like is now keyed by the account that liked it as well as the tweet, so a tweet liked from two accounts is two likes. Importing an archive into a store that already holds its likes adds new ones beside the old.

A group direct message from the archive is sent to whoever was in the group when it was sent, following joins and leaves, rather than to the members in its header. A group you started, which has no header, has you and everyone who wrote in it.

Everything from an archive is asserted when X generated it, from its `manifest.js`, rather than at each tweet's or message's own time, or, for a like, the time of import. A second import of the same archive restates the first, and a newer archive's values win over an older one's.

From the archive, Twitter also reads your profile (`profile`), your followers and the accounts you follow (`followers`, `following`), and your chats with Grok (`grok-chats`).

- Your profile is an `UpdateAction` of your account, dated when X generated the archive, with your bio, location, and avatar.
- A follow is an undated `FollowAction` between the two accounts.
- A chat with Grok is a `Thread` of messages, modeled the way Claude's are, with Grok as a `SoftwareAgent`.

A reply's post is `inReplyTo` the post it answers. A link to a tweet, such as a quote or a tweet shared in a message, is that `Post` rather than a page. A tweet's `PublishAction` has its `location` when it gives coordinates, and the app it was posted with as its `instrument`. A long post from the archive has its full text, from `note-tweet.js`. An edited tweet is its latest version. A tweet you deleted lately also becomes a `DeleteAction`, dated when you deleted it.

A direct message `isPartOf` its conversation, a `Thread` that carries a group's latest name, and its links are its `references`. A reaction to a message is a `RespondAction` whose `Response` is the reaction.

In the schema, `inReplyTo` now relates a post to the post it replies to, as well as a message to a message.

A tweet's or message's text has X's HTML escapes, such as `&amp;` and `&lt;`, undone.

A run of an export that also has an API, such as Twitter's archive, no longer needs `--input` to read the API. Run without one, the export says `--input` is how to give it.
