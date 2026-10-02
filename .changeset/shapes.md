---
'@chronicle.app/etl': minor
---

`sampleTransform`, `shapesOf`, and `renderShapes` sketch what a plugin's transformer makes of its records: for each record type, a tree of the nodes it becomes, with each node's key and properties, marking the ones that are sometimes absent, lists, or computed in the transformer rather than copied from the record. The GitHub and Hacker News plugins keep the sketch in a generated `SHAPES.md`, checked by a test and rewritten with `npm run shapes`.
