---
'@chronicle.app/foodnoms': patch
---

FoodNoms leaves out the foods in a saved recipe or meal, which were never eaten. A food logged to a day without a time is eaten at noon UTC that day, rather than in 1970, and `--since` and `--until` keep it by that day.
