# Writing definitions

Every class and property in [chronicle.ttl](chronicle.ttl) has an
`rdfs:comment`. The comment is the term's definition. It is published on the
schema site and in the package, and it is often the only description of the
term a reader will see.

These rules apply to the comments on terms. Example records in
[examples.ttl](examples.ttl) follow the
[schema site's guidance](../../apps/schema-site/README.md).

Changing a definition changes the vocabulary. See
[Schema versions](README.md#schema-versions) for the release a change needs.

## 1. What a definition says

**1.1 A definition defines its term.** For a class, say what a member of the
class is. For a property, say what it relates and what its value is. Leave
out everything else.

**1.2 Describe what the vocabulary means.** Do not describe how records are
extracted, validated, stored, merged, or displayed. Plugins, transformers,
ingest, and storage do not appear in definitions.

> Not: "Records occurrence time, not the time Chronicle extracted the record."

**1.3 Describe the vocabulary as it is.** Do not mention earlier versions,
renamed or removed terms, or work in progress. Words such as "now", "no
longer", "replaces", "formerly", and "not yet modeled" do not belong.
Changes go in the changelog. Plans go in issues and pull requests.

**1.4 State a limit as a fact about the model.** If the vocabulary does not
cover something, say what the term includes. Do not say what might be added
later.

**1.5 Do not argue for the design.** Explain a choice only when the reader
needs it to choose between two terms.

> "The :agent is who acted. The :instrument is what they used."

**1.6 Do not repeat what the triples declare.** The superclass, domain,
range, and cardinality are stated next to the comment. Say only what they
cannot express.

## 2. Naming terms

**2.1 Write a term as `:name`.** Use the colon and no backticks: `:result`,
`:Event`. On the schema site each one becomes a link to the term's page. A
term in backticks is shown as code and is not linked. A term without its
colon is plain text.

> Not: "A bare ConsumeAction records…" Write ":ConsumeAction".

**2.2 Name only declared terms.** Every `:name` must be a class or property
in `chronicle.ttl`. Do not describe properties or classes the vocabulary
does not have.

**2.3 Use backticks for literal values only:** `1987-06-12`, `XXXX`,
`https://example.com/`.

## 3. Words

**3.1 Use one word for one thing.** The agent is whoever performs an action.
The subject is the person whose records these are. Do not vary these words
for style.

**3.2 Use plain words.** Write with schema terms and ordinary English. Do not
coin words or phrases, such as "dateless itself" or "the session it
constitutes", that the reader has to work out.

**3.3 Leave out filler and hedges.** "Simply", "just", "note that",
"deliberately", and "and the like" add nothing. Write "usually" only when
the meaning varies.

**3.4 Write examples out.** Use "such as" or "for example". Do not use
"e.g.", "i.e.", or "etc."

**3.5 Keep examples generic.** Name a real product or service only when the
term is about it.

## 4. Sentences

**4.1 The first sentence is the definition.** It must make sense alone. The
schema site shows it by itself in lists of terms.

**4.2 Open each kind of term the same way.**

- A class opens with a noun phrase: "A period of employment."
- An action class says what the agent did: "The agent read the :object."
- A property names its value: "When the action occurred." "The tool, device,
  application, or model used to perform an action."

**4.3 Make one statement per sentence.** Keep sentences short. Do not join
clauses with dashes or semicolons.

**4.4 Use parentheses only for examples.**

## 5. Constraints on values

**5.1 List the allowed forms.** When a term restricts its values, give each
allowed form with an example.

**5.2 Then list what is not allowed,** in one sentence that begins "Not
allowed:", with an example of each.

**5.3 Every example must be right.** Each allowed example must be valid, and
each example after "Not allowed:" must be invalid.

## 6. Length

**6.1 Write what the definition needs and no more.** Most terms need one to
three sentences. Datatypes and terms that restrict their values need more.

## 7. Examples

| Term          | Before                                                                                                                                                                                                                                  | After                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `:timestamp`  | The instant when the action occurred, as reported by the source. Records occurrence time, not the time Chronicle extracted the record.                                                                                                  | When the action occurred.                                                                                                         |
| `:instrument` | The tool, device, application, or model used to perform an action. The :agent identifies who acted; :instrument identifies what they used.                                                                                              | The tool, device, application, or model used to perform an action. The :agent is who acted. The :instrument is what they used.    |
| `:Tenure`     | A stretch of employment — the :result of the :ExperienceAction whose span it takes. Dateless itself; carries the :employer (an :Organization) and the :role held. The subject's :memberOf run over the employer derives from this span. | A period of employment. It is the :result of an :ExperienceAction, which gives its start and end. Its :role is the position held. |

The `:Tenure` rewrite also drops `:employer`, which the vocabulary does not
declare.
