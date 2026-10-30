---
'@chronicle.app/claude-code': minor
---

Transcripts from before Claude Code marked a person's prompts with an `origin` are extracted too. A `user` line without one is a prompt unless Claude Code wrote it: a compaction summary, a subagent's line, a tool result, a system prompt, a slash command's echo or output, shell-mode input or output, a reminder, an interruption, the plan a cleared session starts from, or a bare `/command`. Sessions from before mid-2026 were skipped as having no prompts, and prompts that newer transcripts left without an origin were dropped.

A line holding U+2028 or U+2029 inside a string is read as one line, rather than split into pieces that were skipped as unparseable.
