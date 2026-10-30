# @chronicle.app/claude-code

`ClaudeCodeExtractor` reads a session JSONL file, a project directory, or the Claude Code projects root (`~/.claude/projects` by default). `ClaudeCodeTransformer` emits MessageAction/Message records grouped into session Threads and machine-scoped Projects, with assistant models recorded as instruments.

Options: `assistant: 'full' | 'terse' | 'off'` (default full), `tools: boolean` (default false), inclusive `since`/`until`, and `limit` (zero means unlimited). Sessions are visited by newest modification time, then messages in reverse transcript order. This is file order, not a global timestamp sort. Subagent subdirectories are excluded when scanning projects.

A `user` line with an `origin` is a prompt when its kind is `human`. Older transcripts carry no origin, so a line without one is a prompt unless Claude Code wrote it: a compaction summary, a subagent's line, a tool result, a system prompt, or text the harness writes itself, such as a slash command's echo or output, shell-mode input or output, a reminder, an interruption, the plan a cleared session starts from, or a bare `/command`. Meta messages, synthetic assistant replies, and sessions without a human prompt or working directory are excluded. Malformed JSON lines and invalid message dates are skipped.

Account identity comes from the transcript, or the matching install's `.claude.json` account metadata when the input is under `.claude`. Copies outside that install do not borrow the host account. Source account ids win over install metadata. Transformer `hostname` can identify the original machine for exported transcripts. Tools are summaries only; no commands are executed.

Tests generate synthetic transcripts and account metadata in temporary directories; no personal sessions are read.
