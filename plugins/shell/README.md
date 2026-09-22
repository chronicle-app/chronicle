# @chronicle.app/shell

`ShellHistoryExtractor` reads bash, zsh, and fish histories; `ShellHistoryTransformer` emits ExecuteAction/Command records with the local username and machine realm. Pass `input` and optionally `shell` (`auto`, `bash`, `zsh`, `fish`). With an explicit file, auto-detection examines that file; otherwise standard history paths are used. Transformer config can override `username` and `hostname` for exported histories.

Records are yielded in reverse file order; limits apply after inclusive `since`/`until` filtering. `limit: 0` is unlimited. Untimestamped or malformed-time entries remain available as raw records (unless a time window is requested), but do not become fabricated dated actions. No commands from history are executed.

The unified extractor replaces the old deprecated Bash/Zsh classes. It reads the file in memory. Multiline shell syntax is not reconstructed; use raw records when the history format does not provide one complete command per entry.

Tests use temporary history files and an explicit fixture identity, never personal history.
