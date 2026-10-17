# @chronicle.app/apple-voice-memos

## 0.5.0

### Patch Changes

- 27ce35d: `@chronicle.app/icloud` is now `@chronicle.app/apple`, since it reads Apple data on a Mac beyond iCloud: the Apple Account signed in, AddressBook contacts, and now binary property lists. Its exports are unchanged, and records still name the Apple Account `icloud`, so every identity stays the same. It adds `parseBinaryPlist` and `Uid`, which read a binary property list such as an NSKeyedArchiver archive; the Shazam plugin, which had its own, now uses them. The plugins that used `@chronicle.app/icloud` depend on `@chronicle.app/apple` instead.
- Updated dependencies [27ce35d]
  - @chronicle.app/apple@0.5.0
  - @chronicle.app/etl-sqlite@0.5.0

## 0.4.0

### Minor Changes

- ac25170: Add the Apple Voice Memos plugin, run as `chronicle extract apple-voice-memos`. It extracts the recordings in the Voice Memos library on a Mac, which syncs through iCloud and so holds memos from every device on the account. Each memo is a `RecordAction` dated when recording started, and its `result` is the recording, an `AudioObject` keyed by the memo's ID, with its title, duration, and file. Apple's transcript, when the memo has one, is the recording's `transcript`. The action's `instrument` is what the audio file says recorded it: the OS release, an `OperatingSystem` as the file writes it, and the kind of device, a `ProductModel` keyed by its Wikidata ID, but never which device. Memos in Recently Deleted are left out.

  The vocabulary adds two kinds of `CreateAction`, `RecordAction` for recording sound or video and `PhotographAction` for taking a photograph, and `transcript`, the words spoken in an audio or video recording or a podcast episode, written out as text. `Software` is the new parent of `SoftwareApplication`, `OperatingSystem` (an operating system or one release of it), and `AIModel` (a trained model, such as a language model).

### Patch Changes

- Updated dependencies [b0982a5]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/icloud@0.4.0
