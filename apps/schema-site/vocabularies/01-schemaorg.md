# schema.org

schema.org is a shared vocabulary for describing things on the web, such as people, places, creative works, and actions. Chronicle borrows its model and names: where schema.org has a term for something, Chronicle uses that term's name and points its own term to schema.org's.

## What it's for

Web publishers add schema.org to their pages so that search engines and other programs can tell what a page is about, such as an article, a recipe, a product, or an event. It covers hundreds of kinds of things. Its rules are loose: a property lists the types it expects, but other values are allowed, and no property is required.

## Shared model

Chronicle describes what happened the way schema.org does. An :Action has an :agent who performed it and an :object it was carried out on, and it can have a :result, an :instrument, a :target, and a :location. A work is a :CreativeWork, with an :author and a :datePublished. A media file is a :MediaObject, with subclasses such as :VideoObject.

Most Chronicle classes sit under the same parents as the schema.org classes they are named after. Each class and property points to the closest schema.org term, as a hint for mapping data. The hints don't make a Chronicle :VideoObject a schemaorg:VideoObject: Chronicle's values follow its own rules, and some terms differ in scope or structure, as the notes below say.

## What Chronicle adds

- **Where each record came from.** Every record has a :source and a :sourceId, and a key built from the source's own identifiers, so the same thing gets the same identity each time it is read.
- **What happened in one person's history.** Chronicle has actions that schema.org does not, such as :CompleteAction, :ExecuteAction, :MessageAction, :PublishAction, and :VisitAction. It also has periods of life, such as a :Tenure or a :DeviceSession.
- **Stricter values.** Each property lists the types its values can have and whether it takes one value or a list, and records that break either rule are rejected. A :DateTime can be a date known only to the year, or an uncertain one.

## What Chronicle leaves out

Most of schema.org. Chronicle adds a term only when a source needs it, so it has no terms for commerce, such as offers and prices, or for the many kinds of web pages and organizations that schema.org describes.

## Translating a record

To read a Chronicle record as schema.org, replace each term with the schema.org term it maps to. A term that is the same as a schema.org term, or a kind of one, keeps its meaning. A close match needs the note beside it. For example, a :width is a number of pixels, and the :object of a :TravelAction is where the travel began, which schema.org gives as schemaorg:fromLocation.

Some schema.org names mean something else in Chronicle, such as :Project and :QuoteAction. The tables below mark these as not the same. Chronicle's own terms, such as :sourceId and :VisitAction, have no schema.org counterpart.
