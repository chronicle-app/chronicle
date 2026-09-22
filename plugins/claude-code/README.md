# @chronicle.app/claude-code

`ClaudeCodeExtractor` reads a session JSONL file, a project directory, or the Claude Code projects root (`~/.claude/projects` by default). `ClaudeCodeTransformer` emits MessageAction/Message records grouped into session Threads and machine-scoped Projects, with assistant models recorded as instruments.

Options: `assistant: 'full' | 'terse' | 'off'` (default full), `tools: boolean` (default false), inclusive `since`/`until`, and `limit` (zero means unlimited). Sessions are visited by newest modification time, then messages in reverse transcript order. This is file order, not a global timestamp sort. Subagent subdirectories are excluded when scanning projects.

Preserves the existing format contract: user prompts must carry `origin.kind: 'human'`; meta messages, tool results, synthetic assistant replies, and sessions without a human prompt/working directory are excluded. Malformed JSON lines and invalid message dates are skipped. Older transcript formats without human-origin metadata are not inferred.

Account identity comes from the transcript, or the matching install's `.claude.json` account metadata when the input is under `.claude`. Copies outside that install do not borrow the host account. Source account ids win over install metadata. Transformer `hostname` can identify the original machine for exported transcripts. Tools are summaries only; no commands are executed.

Tests generate synthetic transcripts and account metadata in temporary directories; no personal sessions are read.
