---
'@chronicle.app/apple-health': minor
'@chronicle.app/schema': minor
---

Add the Apple Health plugin, run as `chronicle extract apple-health --input export.zip`. It reads the export the Health app makes, zipped or unzipped, and streams its `export.xml`, so memory stays flat however large it is. There are three kinds. `heart` has heart rate, resting and walking heart rate, heart rate variability, heart rate recovery, and the rhythm each ECG found. `sleep` has nights and naps, with their stages. `vitals` has respiratory rate, sleeping wrist temperature, blood oxygen, and blood pressure. Each reading is a `MeasureAction` whose `agent` and `object` are you, with the value as a property of you. Its `instrument` is the device by the name it goes by in Health, the kind of device, and the OS release. Each night or nap is a `SleepAction` whose result is a `SleepSession`, and each of its stages is an `ExperienceAction` whose result is a `Session` that is part of it.

The vocabulary adds `MeasureAction`, `SleepAction`, and `SleepSession`, and properties of a person for the values measured: `heartRate`, `restingHeartRate`, `walkingHeartRate`, `heartRateVariability`, `heartRateRecovery`, `heartRhythm`, `respiratoryRate`, `oxygenSaturation`, `sleepingWristTemperature`, `systolicBloodPressure`, and `diastolicBloodPressure`. Every one but `heartRhythm` is marked with the new `metric` annotation, for tools that keep numeric readings apart from other values. A `Device` can be a watch, and is the instrument of any action done with it.
