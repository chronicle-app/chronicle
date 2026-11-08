# Fitbit shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## exercises

```ts
ExerciseAction key(@type, source, result.sourceId) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) {
    sourceId, name
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  result: ExerciseSession key(@type, source, sourceId) { sourceId, category[], distance?* }
  instrument[]?: Device | SoftwareApplication key(@type, source, sourceId) { sourceId, name }
}
```

## sleep

```ts
SleepAction key(@type, source, result.sourceId) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) {
    sourceId, name
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  result: SleepSession key(@type, source, sourceId) { sourceId }
}
// Every record also becomes:
ExperienceAction key(@type, source, startTime, endTime, result.category) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) {
    sourceId, name
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  result: SleepStage key(@type, source, category, resultOf.startTime, resultOf.endTime) {
    category[]
    isStageOf: SleepSession key(@type, source, sourceId) { sourceId }
  }
}
```

## heart

```ts
MeasureAction key(@type, source, timestamp, object.heartRate) / key(@type, source, startTime, endTime, object.restingHeartRate) {
  timestamp?, startTime?, endTime?
  agent: Person key(@type, source, sourceId) {
    sourceId, name
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  object: Person key(@type, source, sourceId) {
    sourceId, name, heartRate?, restingHeartRate?
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
}
```

## activity

```ts
MeasureAction key(@type, source, startTime, endTime, object.stepCount) {
  startTime, endTime
  agent: Person key(@type, source, sourceId) {
    sourceId, name
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  object: Person key(@type, source, sourceId) {
    sourceId, name, stepCount
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
}
```

## body-measurements

```ts
MeasureAction key(@type, source, sourceId) {
  sourceId, timestamp
  agent: Person key(@type, source, sourceId) {
    sourceId, name
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  object: Person key(@type, source, sourceId) {
    sourceId, name, weight
    sameAs[]: Person key(@type, source, handle) { handle, name }
  }
  instrument[]?: Device key(@type, source, handle) { handle, name }
}
```
