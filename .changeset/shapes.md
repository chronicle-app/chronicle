---
'@chronicle.app/etl': minor
---

`sampleTransform`, `shapesOf`, and `renderShapes` summarize what a plugin's transformer makes of its records: per record type, every input path, every output node and property, and where each output value came from (copied, converted, built around an input value, constant, or computed). The GitHub and Hacker News plugins keep the result in a generated `SHAPES.md`, checked by a test and rewritten with `npm run shapes`.
