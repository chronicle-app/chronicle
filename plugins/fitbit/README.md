# @chronicle.app/fitbit

Your exercises, sleep, heart rate, steps, and weight, from the account archive Fitbit's Data Export page made.

Fitbit no longer makes this archive. Fitbit accounts that weren't moved to a Google account stopped working in 2026, and an archive downloaded before then is the only copy of that history. The export Google Takeout makes for Google Health is a different format, which this plugin doesn't read.

## Usage

Pass the `MyFitbitData` folder, its zip, or the folder in it named for you:

```sh
chronicle extract fitbit --input ~/Downloads/MyFitbitData
chronicle extract fitbit sleep --input ~/Downloads/MyFitbitData.zip --since 2020-01-01
chronicle extract fitbit heart --input ~/Downloads/MyFitbitData --limit 0 --stream --output heart.json
```

There are five kinds. A bare run reads exercises and sleep; `all` reads every kind.

| Kind                | What                                                        | Files                                                         |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `exercises`         | Walks, runs, rides, and workouts, with their distance       | `Physical Activity/exercise-*.json`                           |
| `sleep`             | Nights and naps, with their stages                          | `Sleep/sleep-*.json`                                          |
| `heart`             | Every heart rate reading, and each day's resting heart rate | `Physical Activity/heart_rate-*.json`, `resting_heart_rate-*` |
| `activity`          | The steps taken in each minute                              | `Physical Activity/steps-*.json`                              |
| `body-measurements` | Your weight                                                 | `Personal & Account/weight-*.json`                            |

Records come out newest first. `--since` and `--until` bound when each reading, exercise, or night started, and `--limit` keeps the newest.

A tracker worn for years takes a heart rate reading every few seconds, which is tens of millions of readings, and `heart` reads every one. Each day's readings are in a file of their own, and a run reads them one day at a time, so use `--stream` to write each record as it comes.

## Schema

| Fitbit thing     | Chronicle node                  | Key                                                                      | Properties                                                       |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| An exercise      | `ExerciseAction`                | `@type`, `source`, `result.sourceId`                                     | `agent` (you), `startTime`, `endTime`, `instrument`, `result`    |
| The exercise     | `ExerciseSession`               | `@type`, `source`, `sourceId` (the log's ID)                             | `category` (the kind, such as `Walk`), `distance` (meters)       |
| A tracker or app | `Device`, `SoftwareApplication` | `@type`, `source`, `sourceId` (Fitbit's ID for it)                       | `name`                                                           |
| A night or a nap | `SleepAction`                   | `@type`, `source`, `result.sourceId`                                     | `agent` (you), `startTime`, `endTime`, `result`                  |
| The night        | `SleepSession`                  | `@type`, `source`, `sourceId` (the log's ID)                             |                                                                  |
| A sleep stage    | `ExperienceAction`              | `@type`, `source`, `startTime`, `endTime`, `result.category`             | `agent` (you), `startTime`, `endTime`, `result`                  |
| The stage        | `SleepStage`                    | `@type`, `source`, `category`, `resultOf.startTime`, `resultOf.endTime`  | `category` (the stage), `isStageOf` (the night's `SleepSession`) |
| A reading        | `MeasureAction`                 | `@type`, `source`, `timestamp` (or `startTime` and `endTime`), the value | `agent` and `object` (you), the value as a property of you       |
| A weight         | `MeasureAction`                 | `@type`, `source`, `sourceId` (the log's ID)                             | `timestamp`, `object.weight`, `instrument` (the scale)           |
| You              | `Person`                        | `@type`, `source` (`fitbit`), `sourceId` (your Fitbit user ID)           | `name`; `sameAs` your email and `@me`                            |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**Records Fitbit gave an ID are keyed by it.** An exercise, a night, and a weight each have a log ID. Heart rate and steps readings have none, so a reading is keyed by when it was taken and the value, as Apple Health's are.

**An exercise is an `ExerciseAction` whose result is an `ExerciseSession`.** The session's `category` is the kind of exercise as Fitbit names it, such as `Walk` or `Outdoor Bike`, and its `distance` is in meters, converted from kilometers or miles. Most exercises were noticed by the tracker and have no distance. The tracker or app it came from is the action's `instrument`, by Fitbit's ID for it. Calories, steps, and heart rate during an exercise aren't kept on it: the `activity` and `heart` kinds have the same minutes, and Fitbit's calories include what the body burns at rest. A GPS route was a link to fitbit.com and isn't in the archive.

**The archive mixes clocks.** Exercises, heart rate, and steps are in UTC. Sleep and weight are local times without an offset. Each day's heart rate file holds that local day's readings, so its first and last readings bound the day's offset. Where the profile's time zone fits those bounds, its rules give the instant. Where it doesn't, such as on a trip, the day's offset is the one that fits nearest the zone's. A day without heart rate readings follows the profile's zone. Each day's resting heart rate is over its local day, found the same way.

**A night is in one offset.** Fitbit writes all of a night's times in one offset, so on a night the clocks change, its span on the clock is how long it lasted. A night's offset is the one it started in. Going by the heart rate, Fitbit wrote some such nights in the offset after the change, so on two nights a year a night can be an hour off.

**Each night is read once.** The archive splits sleep into 30-day files, and a night near the edge of one is in the next as well, with different 30-day averages. It's read once, by its ID. A weight logged twice is read once too.

**Stages are split by brief wakes.** A night with stages lists wakes under three minutes in `shortData`, apart from the stage they interrupt. Each one cuts the time it covers out of the stage, as the Fitbit app shows it. Fitbit's `wake` is `awake`, and `rem` is `REM`. A classic night, from an older tracker or a short sleep, has `asleep`, `restless`, and `awake`. Fitbit counts restless time as time awake, so it's `awake`. Neighbouring stages that come out the same are one. `unknown`, a stretch the tracker couldn't read, isn't a stage.

**Weights are in kilograms.** The archive gives a weight without its unit. It's in pounds even for a metric profile, but each log has its BMI too. Read as pounds and as kilograms, a weight implies two heights, and the unit is the one whose height is nearer the profile's. A weight from a scale names it, such as `Aria`, as its `instrument`. One logged by an app or the website has none.

**Every heart rate reading is kept.** Each has a confidence from 0 to 3, which the extracted record keeps. Days with a resting heart rate of zero have none.

**You are your Fitbit account.** `Personal & Account/Profile.csv` gives your user ID, your name, your email, your time zone, and your height. Your email is a `sameAs`, as the mail plugins key people.

**Left out:** calories, distance and floors by the minute, active minutes, time in heart rate zones, VO2 max, sleep scores, the oxygen variation estimate, swim lengths, badges, water, goals, devices, friends, and the login history.

## Tests

The tests run each kind over a synthetic archive, written by the fixture, unzipped and zipped. They never read a real archive.
