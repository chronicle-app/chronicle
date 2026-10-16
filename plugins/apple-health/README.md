# @chronicle.app/apple-health

Your heart readings, sleep, and vitals, from the export the Health app makes.

## Usage

In the Health app on your iPhone, tap your picture, then Export All Health Data. Pass the `export.zip` it makes:

```sh
chronicle extract apple-health --input ~/Downloads/export.zip
chronicle extract apple-health sleep --input ~/Downloads/export.zip --since 2024-01-01
chronicle extract apple-health -t all --input ~/Downloads/export.zip --limit 0 --stream --output health.json
```

`--input` also takes the `apple_health_export` folder it unzips to, a folder that holds either, or `export.xml`. A zip is read in place, never unpacked to disk.

There are three kinds. Apple Health declares no default kinds: a bare `chronicle extract apple-health` asks which, and outside a terminal says to name them or pass `-t all`.

- `heart`: heart rate, resting heart rate, walking heart rate, heart rate variability, heart rate recovery, and the rhythm each ECG found
- `sleep`: nights and naps, with their sleep stages
- `vitals`: respiratory rate, sleeping wrist temperature, blood oxygen, and blood pressure

`export.xml` holds everything Health keeps and can be several gigabytes. It's streamed, and each kind reads it once. A run also reads it once more to learn which sources are devices. Records come out newest first. The file keeps no useful order, so each kind holds what it reads, in a compact form, until it has read all of it. A whole export can be a million readings or more, so use `--stream` to write each record as it comes rather than holding every record until the end. `--since` and `--until` bound when each reading or sleep period started, and `--limit` keeps the newest.

## Schema

| Health thing     | Chronicle node        | Key                                                                                                                              | Properties                                                                                                                                                                                                                            |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A reading        | `MeasureAction`       | `@type`, `source`, `timestamp` (or `startTime` and `endTime`), `instrument[*].handle`, and the value, such as `object.heartRate` | `agent` and `object` (you), `instrument`, `timestamp`, or `startTime` and `endTime` for a value over a period                                                                                                                         |
| The value        | a property of you     |                                                                                                                                  | `heartRate`, `restingHeartRate`, `walkingHeartRate`, `heartRateVariability`, `heartRateRecovery`, `heartRhythm`, `respiratoryRate`, `oxygenSaturation`, `sleepingWristTemperature`, `systolicBloodPressure`, `diastolicBloodPressure` |
| A night or a nap | `SleepAction`         | `@type`, `source`, `startTime`, `endTime`, `instrument[*].handle`                                                                | `agent` (you), `instrument`, `startTime`, `endTime`, `result`                                                                                                                                                                         |
| The night        | `SleepSession`        | `@type`, `source`, `resultOf.startTime`, `resultOf.endTime`, `resultOf.instrument[*].handle`                                     |                                                                                                                                                                                                                                       |
| A sleep stage    | `ExperienceAction`    | `@type`, `source`, `startTime`, `endTime`, `instrument[*].handle`, `result.category`                                             | `agent` (you), `instrument`, `startTime`, `endTime`, `result`                                                                                                                                                                         |
| The stage        | `Session`             | `@type`, `source`, `category`, `resultOf.startTime`, `resultOf.endTime`, `resultOf.instrument[*].handle`                         | `category` (the stage), `isPartOf` (the night's `SleepSession`)                                                                                                                                                                       |
| The device       | `Device`              | `@type`, `source` (`apple-health`), `handle` (the name it goes by in Health)                                                     | `name`, `model` (its hardware, such as `Watch7,1`)                                                                                                                                                                                    |
| An ECG's watch   | `ProductModel`        | `source` (`apple-model-id`), `sourceId` (Apple's identifier for the model, such as `Watch7,1`)                                   |                                                                                                                                                                                                                                       |
| An app           | `SoftwareApplication` | `@type`, `source` (`apple-health`), `handle` (its name in Health)                                                                | `name`                                                                                                                                                                                                                                |
| You              | `Person`              | `@type`, `source` (`icloud`), `sourceId` (your account's DSID)                                                                   | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                                                                                                   |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**A reading is a `MeasureAction` on you.** You're its `agent` and its `object`, and the value measured is a property of you, such as your `heartRate`. Each value property is marked `metric` in the vocabulary. A reading taken at an instant has a `timestamp`. One over a period, such as a day's resting heart rate, has a `startTime` and `endTime`.

**Records are keyed by what they say.** The export gives samples no IDs, and Chronicle doesn't make them up, so a reading is keyed by its own fields: when it was taken, the names of its instruments (`instrument[*].handle`: the device or app), and the value it measured, by the property it's on, such as `object.heartRate`. A sample the export repeats exactly has the same key. Two different values from one device at the same instant are two readings. Each new export repeats everything, so the same reading keeps its key from one export to the next. A night, and each of its stages, is keyed by its times and its source, and a stage also by the stage.

**The instrument is the device or the app.** A device is keyed by the name it goes by in Health, such as `Sam’s Apple Watch`, with its hardware as its `model`, such as `Watch7,1`. A renamed device is a second device. A source that never describes a device, such as Sleep Cycle, or values you entered in Health, is a `SoftwareApplication` named by its name. Some samples, such as sleep and resting heart rate, don't describe their device. They take its model from what the rest of the export says about the source. An ECG names only the watch's model, so its instrument is a `ProductModel` keyed by Apple's identifier for it. The OS release a sample names isn't kept.

**Times are instants.** Every date in `export.xml` carries the UTC offset in effect when the export was made, not where the sample was taken: an export made in summer writes winter samples with a summer offset. The instant is right, and that's what's kept. Sleep and some other samples name their time zone, such as `America/Toronto`. The extracted record keeps it, but the vocabulary has no term for it yet.

**Sleep is grouped into periods, each source on its own.** A source's sleep samples that overlap or fall within two hours of each other are one period, such as a night or a nap. Each period is a `SleepAction` whose result is a `SleepSession`. Each sample in it is a stage: an `ExperienceAction` whose result is a `Session` that `isPartOf` the period's `SleepSession`, with the stage as its `category`: `in bed`, `asleep`, `core`, `deep`, `REM`, or `awake`. Sources aren't merged. A phone's time in bed and a watch's stages for the same night are two nights, told apart by their instrument. Time in each stage is the sum of its stages, so no totals are stored. A session has no times of its own, so its key reads them from the action it's the result of, through `resultOf`, the inverse of `result`. In each stage's record the night's `SleepSession` gives its `SleepAction` as its `resultOf`, by its key alone, so the night has the same key there as in its own record.

**A blood pressure is one reading.** Health pairs the two values in a correlation, and the export repeats each value as a sample of its own. The correlation gives one reading with both values, and the repeated samples are skipped.

**An ECG gives its rhythm.** Only the header of each recording in `electrocardiograms/` is read: when it was recorded, its classification, and the watch's hardware. A recording classified as a rhythm, `Sinus Rhythm` or `Atrial Fibrillation`, gives a `heartRhythm` reading. One that's inconclusive says nothing about the rhythm and is left out. The voltage samples, the symptoms, and the name and date of birth the file starts with aren't read. The recording names the watch's model but not the watch, so its only instrument is the model.

**Values are in the units the vocabulary defines.** Heart rates are in beats per minute, heart rate variability in milliseconds, blood oxygen as a fraction from 0 to 1, temperatures in degrees Celsius, and blood pressure in millimeters of mercury. A sleeping wrist temperature in degrees Fahrenheit is converted. A sample in a unit there's no conversion for is left out, and the run's summary says how many.

**You are your iCloud account.** The export doesn't say whose it is, so it's taken to be the iCloud account signed in on this Mac, from `@chronicle.app/icloud`. An explicit `account` object describes someone else's export. With no account, or `account` set to null, you are Health's own record of you, keyed by `source` alone.

**Left out:** heart rate variability's beat-by-beat values, the motion context of a heart rate (sedentary or active), low and high heart rate notifications, workouts and their routes, activity rings, steps, distance, energy, food, and the other types Health keeps. `export_cda.xml` is a clinical-format copy of the same data and isn't read.

## Tests

The tests run each kind over a synthetic export, written by the fixture, and pass an explicit iCloud account. They never read a real Health export or the host's iCloud account.
