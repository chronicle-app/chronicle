# Apple Health shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## heart

```ts
MeasureAction key(startTime, endTime, instrument[*].handle, object.heartRate) / key(timestamp, object.heartRhythm) / key(timestamp, instrument[*].handle, object.heartRateRecovery) / key(timestamp, instrument[*].handle, object.systolicBloodPressure, object.diastolicBloodPressure) / key(timestamp, instrument[*].handle, object.heartRate) / key(startTime, endTime, instrument[*].handle, object.heartRateVariabilitySdnn) / key(startTime, endTime, instrument[*].handle, object.restingHeartRate) / key(startTime, endTime, instrument[*].handle, object.walkingHeartRate) {
  startTime?, endTime?, timestamp?
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: Person key(sourceId) { sourceId, handle, sameAs[], heartRate?, heartRhythm?, heartRateRecovery?, systolicBloodPressure?, diastolicBloodPressure?, heartRateVariabilitySdnn?, restingHeartRate?, walkingHeartRate? }
  instrument[]: Device | ProductModel | SoftwareApplication key(handle) / key(sourceId) { handle?, name?, model?, sourceId? }
}
```

## respiratory

```ts
MeasureAction key(timestamp, instrument[*].handle, object.oxygenSaturation) / key(startTime, endTime, instrument[*].handle, object.respiratoryRate) {
  timestamp?, startTime?, endTime?
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: Person key(sourceId) { sourceId, handle, sameAs[], oxygenSaturation?, respiratoryRate? }
  instrument[]: Device key(handle) { handle, name, model }
}
```

## body-measurements

```ts
MeasureAction key(startTime, endTime, instrument[*].handle, object.sleepingWristTemperature) {
  startTime, endTime
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: Person key(sourceId) { sourceId, handle, sameAs[], sleepingWristTemperature }
  instrument[]: Device key(handle) { handle, name, model }
}
```

## activity

```ts
MeasureAction key(startTime, endTime, instrument[*].handle, object.activeEnergyBurned) / key(startTime, endTime, instrument[*].handle, object.stepCount) {
  startTime, endTime
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: Person key(sourceId) { sourceId, handle, sameAs[], activeEnergyBurned?, stepCount? }
  instrument[]: SoftwareApplication | Device key(handle) { handle, name, model? }
}
```

## sleep

```ts
SleepAction key(startTime, endTime, instrument[*].handle) {
  startTime, endTime
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  instrument[]: Device | SoftwareApplication key(handle) { handle, name, model? }
  result: SleepSession key(resultOf.startTime, resultOf.endTime, resultOf.instrument[*].handle) {  }
}
// Every record also becomes:
ExperienceAction key(startTime, endTime, instrument[*].handle, result.category) {
  startTime, endTime
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  instrument[]: Device | SoftwareApplication key(handle) { handle, name, model? }
  result: Session key(category, resultOf.startTime, resultOf.endTime, resultOf.instrument[*].handle) {
    category[]
    isPartOf[]: SleepSession key(resultOf.startTime, resultOf.endTime, resultOf.instrument[*].handle) {
      resultOf[]: SleepAction key(startTime, endTime, instrument[*].handle) {
        startTime, endTime
        instrument[]: Device | SoftwareApplication key(handle) { handle }
      }
    }
  }
}
```
