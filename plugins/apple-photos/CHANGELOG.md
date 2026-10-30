# @chronicle.app/apple-photos

## 0.6.0

### Patch Changes

- @chronicle.app/apple@0.6.0
  - @chronicle.app/etl-sqlite@0.6.0

## 0.5.0

### Minor Changes

- 679e9c8: Add the Apple Photos plugin, run as `chronicle extract apple-photos`. It reads your Photos library on a Mac in place, read-only, while Photos runs, and reads what Photos knows about each photo and video rather than the files, most of which iCloud keeps off the Mac. Four kinds:

  - `photos`, the default: each photo and video, as what you did to bring it into the library. A camera photo is a `PhotographAction` and a video a `RecordAction`, dated when taken, with the kind of camera as a `ProductModel`, keyed by its make and model in the `exif` namespace. A screenshot is a `ScreenshotAction`, a screen recording a `RecordAction`, and a Live Photo taken during a FaceTime call a `PhotographAction` with FaceTime as its `instrument`. A photo an app saved, such as from WhatsApp or Messages, is an `AddAction` dated when it was added, with the app as its `instrument`. Each action is keyed by the work it made or added: the photo as a `StillImage` or the video as a `MovingImage`, keyed by iCloud's ID for it, with its title, caption, keywords, the people whose faces you named in it as `depicts`, its albums and their folders as `isPartOf`, and the camera's mode it was taken in, such as Portrait or slo-mo, as `sourceFormat`. Each of its original files is a `rendition`, an `ImageObject` or a `VideoObject` keyed by iCloud's fingerprint of the file, with its original file name, size in bytes as `contentSize`, dimensions, type, and length, and a photo's lens and exposure as `exifData`, by EXIF's tag names. A Live Photo has two: its image and its clip. Where it was taken is the action's `location`, or the work's own when an app saved it, since someone else took it. What Photos works out for itself is left out: its model's captions, its search labels, the address it looks up, its guess at which person is you, and the faces it matches to people. So are photos you hid, and photos someone else added to an iCloud Shared Library.
  - `activity`: what you did with your photos, each dated: views, shares, and edits, and from the library's change log, likes and unlikes, caption and title changes, and adds to albums. What follows a photo from iCloud when it arrives, such as after the library is rebuilt, isn't something you did then, and is left out. The change log's bits are looked up by property name in the library's own Core Data model, since they move between macOS versions.
  - `favorites`: your favorites the change log has no date for, from before it begins or that arrived with the photo, each a `LikeAction` with no `timestamp`, keyed by the work.
  - `shared-with-you`: the photos and videos shared with you in Messages, from the library Photos keeps of them, each a `ShareAction` of a work keyed by Messages' attachment ID, crediting who sent it from Messages and dated when they sent it. The work's `rendition` is the attachment as the iMessage plugin keys it. A photo shared in a group chat `target`s the group's `Channel`, keyed as the iMessage plugin keys it.

  A photo or video's work links into Photos by its key, with a `deepLinks` template that opens Photos with it selected.

  `chronicle scan` finds the library in `~/Pictures`, and a scan of a folder finds a library's `Photos.sqlite` by the tables the plugin declares it reads. Extract refuses a database that isn't a Photos library, or one from a Photos without a column it reads, and `chronicle sources info` says it needs Full Disk Access. `chronicle survey` counts each kind, and when, without extracting it: photos and Shared with You from their rows alone, and activity and favorites from the change log, as a run reads it.

  `@chronicle.app/etl-sqlite` adds `assertDatabaseSchema`, the check a `SqliteExtractor` makes of its declared schema, for a reader that opens its database itself.

  The vocabulary adds `ScreenshotAction`; `UnlikeAction`, which withdraws a like; `likes`, the entities an agent likes, which a `LikeAction` adds to and an `UnlikeAction` removes from, declared with the new `assertedBy`, `retractedBy`, and `runPredicate` annotations; `ShareAction`, which maps to schema.org's; `depicts`, something that appears in a picture or video, such as a person; `exifData`, what an image's file records about how it was taken, as an object of EXIF tags and their values, in a new `JSONObject` datatype; `StillImage` and `MovingImage`, a picture or a video as a work, apart from the files that hold it; and `rendition`, a file that holds a work, such as a picture's image file and the short video captured with it, or an episode's audio, which maps to schema.org's `encoding`; and `contentSize`, a media file's size in bytes. `contains` is a file that's part of an entity, such as a message's attachment. `caption` applies to a `StillImage` and a `MovingImage` as well as an `ImageObject`.

### Patch Changes

- Updated dependencies [27ce35d]
- Updated dependencies [679e9c8]
- Updated dependencies [b112f78]
- Updated dependencies [266f585]
  - @chronicle.app/apple@0.5.0
  - @chronicle.app/etl-sqlite@0.5.0
