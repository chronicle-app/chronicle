---
'@chronicle.app/schema': minor
'@chronicle.app/schema-site': minor
---

The vocabulary points each term to the closest schema.org term with `skos:exactMatch`, `skos:closeMatch`, or `skos:broadMatch`, as a hint for mapping data. A reasoner draws nothing from these, so the vocabulary stands on its own. The four `owl:equivalentClass` and two `owl:equivalentProperty` links to schema.org are now `skos:exactMatch`. Generated types are unchanged. The schema site shows how each term relates to schema.org and Activity Streams 2.0, with notes on how they differ, and has a page comparing Chronicle with each vocabulary. The build checks every mapping against the terms of a pinned release of each vocabulary, and fails on a subclass or an equivalence that points to another vocabulary.
