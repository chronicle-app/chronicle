# Chronicle CQL

The Chronicle Query Language: `parse` turns a query into an AST, and
`inferQueryTarget` says whether it asks for entities or actions.
`@chronicle.app/persistence` runs the AST against a store.

## Syntax

Each term in a query narrows what matches. A query returns the kind of thing
it starts from: `type:ListenAction …` returns listens, and `type:Book …`
returns books.

```
type:Book author:{ name:"Ursula K. Le Guin" }       books by Le Guin
type:ListenAction timestamp:2024                    what you listened to in 2024
type:MessageAction agent:@me object:{ recipient:{ name:"Ada" } }
                                                    messages you sent to Ada
```

### Terms

```
name:"The Dispossessed"      equals; quote a value with spaces in it
type:Book,MusicAlbum         either value
pageCount:>=300              compare with >, >=, < or <=
pageCount:300..400           a range, both ends included
genre:*                      has a value
-genre:fantasy               not
earthsea                     full text, as is "a quoted phrase"
```

A space means and, and `|` (or `OR`) separates alternatives:
`type:Book | type:MusicAlbum`. A type also matches its subtypes. `@me` is you,
across every account a source marks as yours.

Full text searches an entity's own text. An action has none, so search an
entity in one of its roles: `type:MessageAction object:{ lunch }`.

### Following references

`{}` after a field runs a query on the entity the field points to. Nest them
to go further.

```
type:ListenAction object:{ artist:{ name:"Björk" } }    listens to Björk
type:VisitAction object:{ name:"Tokyo" }                visits to Tokyo
type:MusicRecording -artist:{ name:"Drake" }            no artist is Drake
type:MusicRecording artist:{ -name:"Drake" }            an artist isn't Drake
type:MusicRecording artist:count>1                      more than one artist
```

Parentheses don't group terms. After a field name, `()` holds the edge's own
arguments, such as a window: `after(2w):{ … }`. So `object:(fraud)` doesn't
parse; use `object:{ fraud }`.

### Time

A partial date is its whole period, and matches anything that overlaps it.

```
timestamp:2024                the year
timestamp:2024-06             the month
timestamp:2019..2021          2019 through 2021
timestamp:>2020               after the whole year, so from 2021
timestamp:>-7d                the last seven days
timestamp:last-week           also today, yesterday, this-month, last-year, …
type:ListenAction after(2w):{ type:VisitAction object:{ name:"Tokyo" } }
                              listens in the two weeks after a visit to Tokyo
```

`before(…)` and `near(…)` take a window the same way, and `while:{ … }`
matches what happened during the other.
