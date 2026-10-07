---
'@chronicle.app/schema': minor
'@chronicle.app/foodnoms': patch
---

`DateTime` is now the one datatype for a point in time, and `Date` is gone. A `DateTime` is a JavaScript `Date` or an EDTF string at the precision the source knows: an instant with its zone (`2024-03-02T14:05:00Z`), a year, month, or day (`1987`, `1987-06`, `1987-06-12`), unspecified digits (`198X`, `XXXX-03-12`), and an uncertain or approximate date (`1987?`, `1950~`). Strings are checked rather than accepted as they are, and `isDateTime` checks one. FoodNoms timestamps are now instants rather than strings with a space before the time.
