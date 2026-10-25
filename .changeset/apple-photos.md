---
'@chronicle.app/apple-photos': minor
'@chronicle.app/etl-sqlite': minor
'@chronicle.app/schema': minor
---

Add the Apple Photos plugin, run as `chronicle extract apple-photos`. It reads your Photos library on a Mac in place, read-only, while Photos runs, and reads what Photos knows about each photo and video rather than the files, most of which iCloud keeps off the Mac. Four kinds:

- `photos`, the default: each photo and video, as what you did to bring it into the library. A camera photo is a `PhotographAction` and a video a `RecordAction`, dated when taken, with the kind of camera as a `ProductModel`, keyed by its make and model in the `exif` namespace. A screenshot is a `ScreenshotAction`, a screen recording a `RecordAction`, and a Live Photo taken during a FaceTime call a `RecordAction` of its clip. A photo an app saved, such as from WhatsApp or Messages, is an `AddAction` dated when it was added, with the app as its `instrument`. The photo is keyed by iCloud's ID for it, with its title, original file name, caption, keywords, the people whose faces you named in it as `depicts`, its albums and their folders as `isPartOf`, the camera's mode it was taken in, such as Portrait or slo-mo, as `sourceFormat`, a photo's lens and exposure as `exifData`, by EXIF's tag names, and a Live Photo's video. Where it was taken is the action's `location`, or the photo's own when an app saved it, since someone else took it. What Photos works out for itself is left out: its model's captions, its search labels, the address it looks up, its guess at which person is you, and the faces it matches to people.
- `activity`: what you did with your photos, each dated: views, shares, and edits, and from the library's change log, likes and unlikes, caption and title changes, and adds to albums. The change log's bits are looked up by property name in the library's own Core Data model, since they move between macOS versions.
- `favorites`: your favorites from before the change log begins, which have no date, each a `LikeAction` with no `timestamp`, keyed by the photo.
- `shared-with-you`: the photos and videos shared in Messages, from the library Photos keeps of them, each a `ShareAction` keyed by Messages' attachment ID, crediting who sent it from Messages, with the photo `sameAs` the iMessage plugin's attachment.

A photo or video links into Photos by its key, with a `deepLinks` template that opens Photos with it selected.

`chronicle scan` finds the library in `~/Pictures`, and a scan of a folder finds a library's `Photos.sqlite` by the tables the plugin declares it reads. Extract refuses a database that isn't a Photos library, or one from a Photos without a column it reads, and `chronicle sources info` says it needs Full Disk Access. `chronicle survey` counts each kind, and when, without extracting it: photos and Shared with You from their rows alone, and activity and favorites from the change log, as a run reads it.

`@chronicle.app/etl-sqlite` adds `assertDatabaseSchema`, the check a `SqliteExtractor` makes of its declared schema, for a reader that opens its database itself.

The vocabulary adds `ScreenshotAction`; `UnlikeAction`, which withdraws a like; `likes`, the entities an agent likes, which a `LikeAction` adds to and an `UnlikeAction` removes from, declared with the new `assertedBy`, `retractedBy`, and `runPredicate` annotations; `ShareAction`, which maps to schema.org's; `depicts`, a person who appears in an image or video; and `exifData`, what an image's file records about how it was taken, as an object of EXIF tags and their values, in a new `JSONObject` datatype. `caption` applies to a `VideoObject` as well as an `ImageObject`.
