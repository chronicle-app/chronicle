---
'@chronicle.app/schema': minor
'@chronicle.app/schema-site': minor
---

The vocabulary maps its terms to schema.org. A class that is a kind of a schema.org class lists it with `rdfs:subClassOf`, and other terms use `skos:exactMatch`, `skos:closeMatch`, or `skos:broadMatch`. The generator ignores parents outside the Chronicle namespace, so generated types are unchanged. The schema site shows how each term relates to schema.org and Activity Streams 2.0, with notes on how they differ, and has a page comparing Chronicle with each vocabulary. The build checks every mapping against the terms of a pinned release of each vocabulary.
