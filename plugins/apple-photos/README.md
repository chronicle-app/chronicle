# @chronicle.app/apple-photos

Your Photos library on a Mac: each photo and video, who is in it, what's in it, and what you did with it, and the photos shared with you in Messages, with who sent them.

## Usage

```sh
chronicle extract apple-photos
chronicle extract apple-photos activity --since 2026-01-01
chronicle extract apple-photos photos activity favorites shared-with-you
chronicle extract apple-photos --input "/path/to/Photos Library.photoslibrary"
```

The library is `~/Pictures/Photos Library.photoslibrary`, and the plugin reads its `database/Photos.sqlite` in place, read-only, with built-in `node:sqlite`, while Photos runs. It also reads two databases beside it when they're there: the captions Photos' model wrote, in `private/com.apple.mediaanalysisd/MediaAnalysis/MediaAnalysis.sqlite`, and the labels Photos' search shows, in `database/search/leo.sqlite`. Your terminal needs Full Disk Access.

It reads what Photos knows about each photo, not the photo itself. Most originals in an iCloud library aren't on the Mac, so no file is read or downloaded, and no record has a `contentPath`.

| Record type       | Default | What it is                                                                                 |
| ----------------- | ------- | ------------------------------------------------------------------------------------------ |
| `photos`          | yes     | One record for each photo and video in your library                                        |
| `activity`        | no      | Views, shares, edits, caption and title changes, likes and unlikes, and adds to albums     |
| `favorites`       | no      | One record listing your favorites that have no date                                        |
| `shared-with-you` | no      | The photos and videos shared in Messages, with who sent them, from `--syndication` (below) |

Each kind comes out newest first, and `--since` and `--until` bound when each record happened.

`shared-with-you` reads the library Photos keeps of what was shared in Messages, `~/Library/Photos/Libraries/Syndication.photoslibrary` (`--syndication`), and Messages' `~/Library/Messages/chat.db` (`--messages`) for who sent each one.

## Schema

| Photos thing                   | Chronicle node                                                                            | Key                                                                                              | Properties                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taking a photo or video        | `PhotographAction`, `RecordAction`, or `ScreenshotAction`                                 | `@type`, `source`, `sourceId` (the photo's iCloud ID)                                            | `agent` (you), `timestamp` (when it was taken), `instrument` (the kind of camera), `location`, `result` (the photo)                                                                                                                                                                                                               |
| Saving one from an app         | `AddAction`                                                                               | `@type`, `source`, `sourceId` (the photo's iCloud ID)                                            | `agent` (you), `timestamp` (when it was added), `instrument` (the app), `location`, `object` (the photo)                                                                                                                                                                                                                          |
| The photo or video             | `ImageObject` or `VideoObject`                                                            | `@type`, `source` (`apple-photos`), `sourceId` (iCloud's ID for it, `ZCLOUDASSETGUID`)           | `name` (its title), `handle` (its original file name), `caption`, `aiDescription` (the caption Photos' model wrote), `tags` (its keywords), `category` (the labels Photos' search shows), `depicts` (the people you named), `isPartOf` (its albums), `contains` (a Live Photo's video), `width`, `height`, `duration`, `mimeType` |
| A person you named             | `Person`                                                                                  | `@type`, `source` (`apple-photos`), `sourceId` (Photos' ID for them, `ZPERSONUUID`)              | `name`; `sameAs` `@me` for you                                                                                                                                                                                                                                                                                                    |
| An album or a folder           | `Collection`                                                                              | `@type`, `source` (`apple-photos`), `sourceId` (iCloud's ID for it, `ZCLOUDGUID`)                | `name`, `isPartOf` (its folder)                                                                                                                                                                                                                                                                                                   |
| The kind of camera             | `ProductModel`                                                                            | `source` (`exif`), `sourceId` (the make and model its files name, such as `Apple iPhone 14 Pro`) | `name`                                                                                                                                                                                                                                                                                                                            |
| The app that saved it          | `SoftwareApplication`                                                                     | `@type`, `source` (`apple-bundle-id`), `handle` (its bundle identifier)                          | `name`                                                                                                                                                                                                                                                                                                                            |
| Something you did with a photo | `ViewAction`, `ShareAction`, `UpdateAction`, `LikeAction`, `UnlikeAction`, or `AddAction` | `@type`, `source`, `object.sourceId`, `timestamp`, and for an `AddAction` `target.sourceId`      | `agent` (you), `object` (the photo, by key), `target` (the album, for an `AddAction`)                                                                                                                                                                                                                                             |
| Your favorites with no date    | `UpdateAction` carrying you                                                               | `@type`, `source`, `object.sourceId`, `timestamp` (when the library last changed)                | `agent` (you, by key), `object` (you, with `likes`, the photos by key, and `@asserts` `likes`)                                                                                                                                                                                                                                    |
| A photo shared in Messages     | `ShareAction`                                                                             | `@type`, `source`, `sourceId` (Messages' ID for the attachment, `at_0_…`)                        | `agent` (who sent it), `recipient` (who it was sent to, when known), `timestamp` (when it was sent), `object` (the photo, keyed by the same ID, with `handle`, `aiDescription`, `category`, `depicts`, `location`, and `sameAs` the attachment as the `imessage` plugin keys it)                                                  |
| Who sent it                    | `Person`                                                                                  | `@type`, `source` (`apple-photos`), `handle` (their phone number or email address in Messages)   | `sameAs` the participant as the `imessage` plugin keys them: an `Agent` keyed by `source` (`icloud` for iMessage, `phone` for SMS) and `handle`                                                                                                                                                                                   |
| You                            | `Person`                                                                                  | `@type`, `source` (`icloud`), `sourceId` (your account's DSID)                                   | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                                                                                                                                                                                               |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**What you did to make each photo.** A photo from a camera is a `PhotographAction` and a video a `RecordAction`, with the photo as its `result`, dated when it was taken. A screenshot is a `ScreenshotAction`, and a screen recording a `RecordAction`. A Live Photo taken during a FaceTime call is a `RecordAction` whose `result` is the clip, which `contains` the still, with FaceTime as its `instrument`. Anything else an app added, such as a photo saved from WhatsApp, Instagram, or Messages, or AirDropped, is an `AddAction` with the photo as its `object`, dated when it was added, and the app as its `instrument` when Photos names one.

- The test for a camera photo is strict: the Camera app added it, or no app did, and its file names a camera. A photo of yours saved from Instagram is a save, which the Instagram plugin can claim.
- Screenshots and screen recordings are told by their kind first, since many have no app.
- A photo with no app and no camera data is a save. Most have no date in their file, and the video among them is mostly what Messages compresses to.

**When it was taken is Photos' date.** The date is `ZDATECREATED`, a UTC instant, exactly as Photos has it, including a date you changed in Photos. A photo whose file has no date has the date Photos gave it, usually when the file was saved.

**Keys are iCloud's IDs.** A photo is keyed by iCloud's ID for it (`ZCLOUDASSETGUID`), an album by its own (`ZCLOUDGUID`), and a person by Photos' ID for them (`ZPERSONUUID`). They stay the same when the library is rebuilt from iCloud and on every Mac on the same library, while the library's own IDs (`ZUUID`) don't. A photo that isn't in iCloud is keyed by the library's ID.

**A photo links into Photos by its key.** The plugin declares a `deepLinks` template for `ImageObject` and `VideoObject`, `photos://asset?identifier=<key>&cloud-identifier=<key>:001`, which opens Photos with the photo selected. Photos finds a photo by iCloud's ID in `cloud-identifier`, with the `:001` it gives every photo's ID, and by the library's ID in `identifier`, so one template covers a photo that isn't in iCloud too. Photos doesn't document the link. A Shared with You photo is keyed by Messages' ID, which Photos doesn't know it by, so its link doesn't open it.

**The kind of camera, not which camera.** A camera photo's `instrument` is a `ProductModel` named by the make and model its file gives, such as `Apple iPhone 14 Pro`, keyed by that name in the `exif` namespace, so other sources reading the same files name the same one. Photos can't tell two phones of one model apart, so there's no `Device`.

**People you named.** A photo `depicts` each person you named in Photos. A person merged into another is the one they were merged into, and the person Photos knows is you is `sameAs` `@me`. Pets, faces you haven't named, and where faces are in the photo are left out. Few named people link to a contact, so they don't merge with contacts by themselves.

**What's in it.** Its `aiDescription` is the caption Photos' model wrote, from the library's media analysis, kept apart from the `caption` you wrote. Its `category` is the labels Photos' search shows for it, from `leo.sqlite`, macOS 27's search index, without Photos' own placeholder terms. A library from before macOS 27 keeps its search index elsewhere, and its photos have no labels. Text Photos read in an image isn't extracted: Photos keeps it compressed, in a format of its own.

**Albums are what you made.** A photo `isPartOf` each album you made that it's in, and an album `isPartOf` its folder. Recently Deleted, shared albums, Memories, and the albums Photos makes are left out. Each run reads the library as it is now, so the photo asserts its albums, keywords, people, and labels: an album the photo left closes, even when it's in none now.

**What's left out.** Photos in Recently Deleted, the burst photos Photos hides, and photos in iCloud shared albums are left out, and so are Memories and the albums Photos makes.

**What you did with a photo is dated.** Photos keeps only when a photo was last viewed, shared, and edited, so `activity` records each as it sees it, and history builds up over runs. The rest comes from the library's change log, Core Data's persistent history, which goes back as far as Photos has kept it:

- A photo's favorite flag changed. The last change made it what it is now, and each change before turned it the other way, so a favorite is a `LikeAction`, and one you removed an `UnlikeAction`.
- Its caption or title changed: an `UpdateAction`. A caption that arrived with the photo, such as when the library was rebuilt, isn't an edit.
- It was added to an album: an `AddAction` with the album as its `target`. Adding photos to an album changes both the album and each photo, in one transaction. A photo added when several albums changed was added to whichever of them it's in now. A photo in none of them gets no add, and taking a photo out of an album isn't recorded, since the album's snapshot closes it.

A change made on this Mac is dated when it was made. One made on another device is dated when this Mac received it from iCloud: usually soon after, but later if the Mac was asleep.

**The change log is read by property name.** Each change has a bitmask of the properties it changed, and Core Data numbers them per entity, differently in each macOS version. The plugin reads the library's own model (`Z_MODELCACHE`) and lays the properties out as Core Data does, so the bits are looked up by name: a photo's `favorite` and `albums`, an album's `assets`, a caption's `longDescription`, and a title's `title`. Entity numbers come from `Z_PRIMARYKEY`, and columns from the tables themselves.

**Favorites with no date are one list.** A favorite from before the change log begins has no date, so it's a `likes` edge from you with no like behind it. All of them are one list on your `Person`, since a `likes` list on each photo's record would have each record close the others'. You assert `likes`, so removing the last one still closes it, and a favorite you remove drops out of the list. A record is an action, so the list arrives on an `UpdateAction` whose `agent` and `object` are you, dated when the library last changed, the way the LinkedIn plugin carries your profile. An unchanged library gives the same record on every run.

**Shared with You.** The photos and videos shared with you, and by you, in Messages are in a library of their own. Each is a `ShareAction` keyed by Messages' ID for the attachment, which Photos keeps (`ZSYNDICATIONIDENTIFIER`), and its photo is keyed by the same ID, with `sameAs` the attachment as the `imessage` plugin keys it, so Photos' analysis lands on the iMessage attachment. Who sent it comes from Messages: a `Person` keyed by their handle, `sameAs` Messages' participant. You're the `agent` when you sent it. You're the `recipient` when you received it, and the other person when you sent it in a one-to-one conversation. Photos with camera data, videos, and screenshots are included. Other images, mostly stickers and images from the web, are left out, and so is a photo whose message is gone from Messages.

**The agent is your iCloud account,** whose library this is, from `@chronicle.app/apple`. It's omitted when no account can be read. An explicit `account` object (or null) describes a copied library without a host account lookup.

## Tests

The tests build a synthetic Photos library, with its own small Core Data model and change log, a Shared with You library, and a Messages database with `node:sqlite`, and pass an explicit iCloud account. They never read the host's Photos library, Messages, or iCloud account.
