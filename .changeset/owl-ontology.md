---
'@chronicle.app/schema': minor
---

`chronicle.ttl` is now an OWL ontology with SHACL shapes. Classes are `owl:Class`, and properties are `owl:ObjectProperty` or `owl:DatatypeProperty` with an `rdfs:domain` and `rdfs:range`, written as an `owl:unionOf` when there are several. A property that takes one value has a SHACL shape with `sh:maxCount 1`, in place of `owl:maxCardinality` on the property. `:domainIncludes` and `:rangeIncludes` are gone. `Text`, `URL`, `DateTime`, and `Number` are datatypes defined over XSD, `URL` is no longer a kind of `Text`, and `DataType` is gone. OWL can't make a datatype a kind of a class, so `Text`, `URL`, and `Number` map to schema.org's with `skos:broadMatch`. `:Base` is the disjoint union of `:Entity` and `:Action`. The generated types and validators are unchanged, and a class with two parents now generates.
