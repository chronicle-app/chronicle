# Activity Streams 2.0

Activity Streams 2.0 is the W3C vocabulary for social activity, such as posting, liking, and following. ActivityPub servers, such as Mastodon, use it to exchange activities. Chronicle records many of the same activities, and most of its actions map to Activity Streams activities.

## What it's for

Activity Streams describes activities so that one server can deliver them to others and show them in a feed. An activity is addressed to an audience, and a feed is a collection of activities that a reader pages through.

## Shared model

Both vocabularies describe an activity by who did it, what it was done to, and what it was directed toward. Chronicle's :agent is as:actor, and :object, :target, :result, and :instrument have the same names and meanings in both. Both have activities for liking, following, joining, leaving, reading, viewing, listening, accepting, and rejecting, and for creating, updating, and deleting things.

Media files line up too. A :VideoObject is an as:Video, an :ImageObject is an as:Image, and an :AudioObject is an as:Audio.

## What Chronicle adds

- **Where each record came from.** Every record has a :source and a key built from the source's own identifiers. Activity Streams identifies an object by its URL.
- **Activities that are not social,** such as :EatAction, :ExecuteAction, :CompleteAction, :BookmarkAction, :CallAction, and :VisitAction.
- **Periods of life,** such as a :Tenure or a :DeviceSession, as the :result of an :ExperienceAction.
- **Dates known in part.** A :DateTime can be a year, such as `1987`, or an approximate month, such as `1987-06~`. Activity Streams gives times as full dates and times.

## What Chronicle leaves out

- **Addressing.** An activity's as:to, as:cc, as:bto, as:bcc, and as:audience say who receives it. Chronicle records a message's :recipient, but not how it was addressed.
- **Collections as lists.** An as:Collection lists its as:items, and a reader pages through them. Chronicle records membership on each member, with :isPartOf.
- **Activities about the feed itself,** such as as:Announce, as:Undo, as:Block, and as:Flag.

## Translating a record

Most terms carry over one to one, and the tables below list them. Some need more than a new name:

- An as:Create gives the work it created as its as:object. A :CreateAction gives it as its :result.
- An as:Travel has no as:object. The :object of a :TravelAction, where the travel began, is its as:origin.
- An as:Arrive has no as:object either. The :Venue of a :CheckInAction is its as:location.
- A :body is plain text or Markdown, but as:content is HTML unless the object's as:mediaType says otherwise.
- A :width or a :height belongs on the as:Link to a media file, not on the object.

Two Activity Streams names mean something else in Chronicle. An as:Relationship is any relationship between two individuals, not a period of partnership, and as:subject is one side of it.
