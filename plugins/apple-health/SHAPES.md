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
MeasureAction key(sourceId) {
  sourceId, timestamp?, startTime?, endTime?
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: Person key(sourceId) { sourceId, handle, sameAs[], heartRate?, restingHeartRate?, walkingHeartRate?, heartRateVariability?, heartRateRecovery?, heartRhythm? }
  instrument[]: Device | ProductModel | OperatingSystem | SoftwareApplication key(handle) / key(sourceId) { handle?, name?*, model?, category[]?, sourceId?, url? }
}
```

## sleep

```ts
SleepAction key(sourceId) {
  sourceId, startTime, endTime
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  instrument[]: SoftwareApplication | Device | ProductModel key(handle) / key(sourceId) { handle?, name, model?, category[]?*, sourceId?*, url?* }
  result: SleepSession key(sourceId) { sourceId }
}
// Every record also becomes:
ExperienceAction key(sourceId) {
  sourceId, startTime, endTime
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  instrument[]: SoftwareApplication | Device | ProductModel key(handle) / key(sourceId) { handle?, name, model?, category[]?*, sourceId?*, url?* }
  result: Session key(sourceId) {
    sourceId, category[]
    isPartOf[]: SleepSession key(sourceId) { sourceId }
  }
}
```

## vitals

```ts
MeasureAction key(sourceId) {
  sourceId, startTime?, endTime?, timestamp?
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: Person key(sourceId) { sourceId, handle, sameAs[], respiratoryRate?, oxygenSaturation?, sleepingWristTemperature?, systolicBloodPressure?, diastolicBloodPressure? }
  instrument[]: Device | ProductModel | OperatingSystem | SoftwareApplication key(handle) / key(sourceId) { handle?, name?, model?, category[]?, sourceId?, url? }
}
```
