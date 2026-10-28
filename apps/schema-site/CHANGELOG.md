# @chronicle.app/schema-site

## 0.5.0

### Minor Changes

- 15228bd: Add the Apple Health plugin, run as `chronicle extract apple-health --input export.zip`. It reads the export the Health app makes, zipped or unzipped, and streams its `export.xml`. There are five kinds, grouped as the Health app groups its data, and a bare run asks which to read. Records come out newest first. `heart` has heart rate, resting and walking heart rate, heart rate variability, heart rate recovery, blood pressure, and the rhythm each ECG found. `respiratory` has respiratory rate and blood oxygen. `body-measurements` has weight and sleeping wrist temperature. `sleep` has nights and naps, with their stages. `activity` has steps and active energy. `--series` reads only the series it names, by Health's name for each type, such as `--series RestingHeartRate,RespiratoryRate`. Without a kind, a run reads the kinds they're in. A kind with none of them doesn't read the export. The flag's help lists every series. Each reading is a `MeasureAction` whose `agent` and `object` are you, with the value as a property of you. Its `instrument` is the device by the name it goes by in Health, with its hardware, such as `Watch7,1`, as its `model`, or the app that wrote the value. An ECG names only the watch's model, a `ProductModel` keyed by Apple's identifier for it. Each night or nap is a `SleepAction` whose result is a `SleepSession`, and each of its stages is an `ExperienceAction` whose result is a `SleepStage` of it: `light`, `deep`, `REM`, `awake`, or `asleep` when the stage isn't known. Time in bed isn't a stage, and isn't read. The export gives nothing an ID, so each record is keyed by what it says: when it happened, the device or app, and what was measured or the stage. Each record is asserted when Health wrote it, by its samples' `creationDate`.

  The vocabulary adds `MeasureAction`, `SleepAction`, `SleepSession`, and `SleepStage`, and properties of a person for the values measured: `heartRate`, `restingHeartRate`, `walkingHeartRate`, `heartRateVariabilitySdnn`, `heartRateRecovery`, `heartRhythm`, `respiratoryRate`, `oxygenSaturation`, `sleepingWristTemperature`, `weight`, `systolicBloodPressure`, `diastolicBloodPressure`, `stepCount`, and `activeEnergyBurned`. Every one but `heartRhythm` is a metric, marked with two new annotations. `metric` says what form a property's values take, and so how its values over a time combine: a `gauge` is a level or a rate, such as a heart rate, and combines as a mean, minimum, or maximum, and a `sum` is an amount, such as a number of steps or the energy burned, and adds up. `unit` is the one unit all its values are in, as a UCUM code such as `/min`, so values from any source can be compared. The generated `METRIC_PROPERTIES` gives each metric's form and unit, and the generator rejects a metric that isn't a gauge or a sum of numbers in one unit. A `Device` can be a watch, and is the instrument of any action done with it. `result` has an inverse, `resultOf`, so a record can name the action it is the result of, and a key can read through it, as a `SleepSession` does for its times. `isStageOf`, with its inverse `hasStage`, links a session to the session it is a stage of, such as a stretch of deep sleep to its night. It is a kind of `isPartOf`, and a whole's stages of the same type don't overlap.

  On the schema site, the keys guide explains paths that follow a property backwards, such as `resultOf.startTime`, and a metric's page gives the form its values take and their unit.

### Patch Changes

- d69e45f: An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

  An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

  An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

  Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message. A Google Calendar event that names no one, such as a holiday or a subscribed feed's, has no agent, rather than its calendar standing in as an `Agent` with the calendar's ID.

  Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

  Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.

- b112f78: An iMessage `MessageAction` has its `Message` as its `result`, not its `object`, since sending a message brings it into being, as a call's session is its `CallAction`'s `result`. The vocabulary's `MessageAction` says so, and its examples and the schema site's guides show it.

  iMessage records are events, so a later run adds to what an earlier one stated and doesn't replace it. A store that kept iMessage records from an earlier release has each message as its action's `object` and its `result` once iMessage runs again. Drop those records and extract iMessage again to keep only the `result`.

  A run's progress line names an action by its `result` when it has no `object`, so an iMessage run shows each message's text rather than `MessageAction`, and a Photos run each photo's title or file name.

## 0.4.0

### Minor Changes

- 243db5a: The vocabulary points each term to the closest schema.org term with `skos:exactMatch`, `skos:closeMatch`, or `skos:broadMatch`, as a hint for mapping data. A reasoner draws nothing from these, so the vocabulary stands on its own. The four `owl:equivalentClass` and two `owl:equivalentProperty` links to schema.org are now `skos:exactMatch`. Generated types are unchanged. The schema site shows how each term relates to schema.org and Activity Streams 2.0, with notes on how they differ, and has a page comparing Chronicle with each vocabulary. The build checks every mapping against the terms of a pinned release of each vocabulary, and fails on a subclass or an equivalence that points to another vocabulary.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.
