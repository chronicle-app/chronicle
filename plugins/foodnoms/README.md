# @chronicle.app/foodnoms

Read the FoodNoms app's SQLite database with `FoodNomsExtractor`, then emit one `EatAction` or `DrankAction` per logged food entry with `FoodNomsTransformer`. `input` defaults to `~/Library/Containers/com.algebraiclabs.foodnoms/Data/Documents/db.db`; reading it needs Full Disk Access. The connection is read-only via built-in `node:sqlite`.

```sh
chronicle extract foodnoms --limit 0
```

Records are food entries, newest first, joined to their meal slot. `since`/`until` are inclusive bounds on the entry date, and `limit: 0` means unlimited. FoodNoms stores dates as UTC text; the extractor adds a `Z` and turns the entry's blob ID into a dashed UUID.

Each action happens at the entry's `timestamp` and is keyed by the entry's ID without its type. FoodNoms has no food-or-drink flag, so an entry whose name contains a common drink word becomes a `DrankAction`, and anything else an `EatAction`. Keeping the type out of the key lets that guess change without changing the action's identity.

The object is a `Meal` keyed by the same entry ID and named after the food. Its `category` is the meal slot: the built-in slots map to Breakfast, Lunch, Dinner and Snacks, a customized slot uses its own name, and an unnamed custom slot has none. The `description` joins the slot, brand, amount and calories.

The agent is the iCloud account owner from `@chronicle.app/icloud`. An explicit `account` object (or null) describes exported data without a host account lookup.

Tests use a synthetic FoodNoms database with an explicit `account`, so they never read the host's FoodNoms data or iCloud account.
