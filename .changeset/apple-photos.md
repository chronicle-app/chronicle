---
'@chronicle.app/apple-photos': minor
'@chronicle.app/schema': minor
---

Add the Apple Photos plugin, run as `chronicle extract apple-photos`. It reads your Photos library on a Mac in place, read-only, while Photos runs, and reads what Photos knows about each photo and video rather than the files, most of which iCloud keeps off the Mac. Four kinds:

- `photos`, the default: each photo and video, as what you did to bring it into the library. A camera photo is a `PhotographAction` and a video a `RecordAction`, dated when taken, with the kind of camera as a `ProductModel`. A screenshot is a `ScreenshotAction`, a screen recording a `RecordAction`, and a Live Photo taken during a FaceTime call a `RecordAction` of its clip. A photo an app saved, such as from WhatsApp or Messages, is an `AddAction` dated when it was added, with the app as its `instrument`. The photo is keyed by iCloud's ID for it, with its title, original file name, caption, keywords, the caption Photos' model wrote as its `aiDescription`, the labels Photos' search shows as its `category`, the people you named as `depicts`, its albums and their folders as `isPartOf`, and a Live Photo's video. Where it was taken is the action's `location`, with Photos' address.
- `activity`: what you did with your photos, each dated: views, shares, and edits, and from the library's change log, likes and unlikes, caption and title changes, and adds to albums. The change log's bits are looked up by property name in the library's own Core Data model, since they move between macOS versions.
- `favorites`: your favorites from before the change log begins, which have no date, as one list of your `likes`, on an `UpdateAction` dated when the library last changed.
- `shared-with-you`: the photos and videos shared in Messages, from the library Photos keeps of them, each a `ShareAction` keyed by Messages' attachment ID, crediting who sent it from Messages, with the photo `sameAs` the iMessage plugin's attachment.

The vocabulary adds `ScreenshotAction`; `UnlikeAction`, which withdraws a like; `likes`, the entities an agent likes, which a `LikeAction` adds to and an `UnlikeAction` removes from, declared with the new `assertedBy`, `retractedBy`, and `runPredicate` annotations; `ShareAction`, which maps to schema.org's; `depicts`, a person who appears in an image or video; and `aiDescription`, a description of an image or video that an AI model wrote. `caption` applies to a `VideoObject` as well as an `ImageObject`, and `recipient` to a `ShareAction`.
