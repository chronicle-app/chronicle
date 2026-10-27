# Apple Health shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## heart

```ts
MeasureAction key(@type, source, startTime, endTime, instrument[*].handle, object.heartRate) / key(@type, source, timestamp, object.heartRhythm) / key(@type, source, timestamp, instrument[*].handle, object.heartRateRecovery) / key(@type, source, timestamp, instrument[*].handle, object.systolicBloodPressure, object.diastolicBloodPressure) / key(@type, source, timestamp, instrument[*].handle, object.heartRate) / key(@type, source, startTime, endTime, instrument[*].handle, object.heartRateVariabilitySdnn) / key(@type, source, startTime, endTime, instrument[*].handle, object.restingHeartRate) / key(@type, source, startTime, endTime, instrument[*].handle, object.walkingHeartRate) {
  startTime?, endTime?, timestamp?
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: Person key(@type, source, sourceId) { sourceId, handle, sameAs[], heartRate?, heartRhythm?, heartRateRecovery?, systolicBloodPressure?, diastolicBloodPressure?, heartRateVariabilitySdnn?, restingHeartRate?, walkingHeartRate? }
  instrument[]: Device | ProductModel | SoftwareApplication key(@type, source, handle) / key(source, sourceId) { handle?, name?, model?, sourceId? }
}
```

## respiratory

```ts
MeasureAction key(@type, source, timestamp, instrument[*].handle, object.oxygenSaturation) / key(@type, source, startTime, endTime, instrument[*].handle, object.respiratoryRate) {
  timestamp?, startTime?, endTime?
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: Person key(@type, source, sourceId) { sourceId, handle, sameAs[], oxygenSaturation?, respiratoryRate? }
  instrument[]: Device key(@type, source, handle) { handle, name, model }
}
```

## body-measurements

```ts
MeasureAction key(@type, source, timestamp, instrument[*].handle, object.weight) / key(@type, source, startTime, endTime, instrument[*].handle, object.sleepingWristTemperature) {
  timestamp?, startTime?, endTime?
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: Person key(@type, source, sourceId) { sourceId, handle, sameAs[], weight?, sleepingWristTemperature? }
  instrument[]: SoftwareApplication | Device key(@type, source, handle) { handle, name, model? }
}
```

## activity

```ts
MeasureAction key(@type, source, startTime, endTime, instrument[*].handle, object.activeEnergyBurned) / key(@type, source, startTime, endTime, instrument[*].handle, object.stepCount) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: Person key(@type, source, sourceId) { sourceId, handle, sameAs[], activeEnergyBurned?, stepCount? }
  instrument[]: SoftwareApplication | Device key(@type, source, handle) { handle, name, model? }
}
```

## sleep

```ts
SleepAction key(@type, source, startTime, endTime, instrument[*].handle) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  instrument[]: Device | SoftwareApplication key(@type, source, handle) { handle, name, model? }
  result: SleepSession key(@type, source, resultOf.startTime, resultOf.endTime, resultOf.instrument[*].handle) {  }
}
// Every record also becomes:
ExperienceAction key(@type, source, startTime, endTime, instrument[*].handle, result.category) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  instrument[]: Device | SoftwareApplication key(@type, source, handle) { handle, name, model? }
  result: SleepStage key(@type, source, category, resultOf.startTime, resultOf.endTime, resultOf.instrument[*].handle) {
    category[]
    isStageOf: SleepSession key(@type, source, resultOf.startTime, resultOf.endTime, resultOf.instrument[*].handle) {
      resultOf[]: SleepAction key(@type, source, startTime, endTime, instrument[*].handle) {
        startTime, endTime
        instrument[]: Device | SoftwareApplication key(@type, source, handle) { handle }
      }
    }
  }
}
```
