---
'@chronicle.app/foodnoms': patch
---

Fix `chronicle extract foodnoms` failing with `ERR_OUT_OF_RANGE` when a meal slot's `sortIndex` is outside JavaScript's safe integer range. FoodNoms can store values near Int64.min there; those now come through as decimal strings.
