---
'@chronicle.app/cli': minor
---

The CLI's questions (confirming a reset or an install, picking a strategy or record types, the kind of plugin to create, and a missing required flag) are drawn by the output module on `@inquirer/core` instead of Ink and React. They draw on stderr with the same colors and glyphs as the rest of the CLI, Esc or Ctrl+C cancels and clears the question, and commands that don't ask anything no longer load what draws them. Since the question to install a missing source's plugin no longer draws on stdout, it's asked when records are piped too. The package exports `confirm`, `select`, `multiSelect`, and `input` in place of `inkInput`, `inkSelect`, `picker`, and `InkPicker`.

The JSON loader's colors and the `plugins` commands' result lines come from the output module too, so the JSON a terminal shows follows `NO_COLOR`.
