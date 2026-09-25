// Rejects commit messages that credit a coding agent as a co-author, which
// AGENTS.md rules out. Runs as the commit-msg hook with the message file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AGENT =
  /claude|anthropic\.com|copilot|cursoragent|cursor\.com|codex|openai\.com|gemini|aider|devin-ai/i;

/** The co-author trailers in `message` that name a coding agent. */
export function agentCoAuthors(message) {
  return message
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^co-authored-by:/i.test(line) && AGENT.test(line));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Git strips comment lines after this hook runs, so skip them here too.
  const message = readFileSync(process.argv[2], 'utf8')
    .split('\n')
    .filter(line => !line.startsWith('#'))
    .join('\n');
  const found = agentCoAuthors(message);
  if (found.length > 0) {
    console.error(
      `Do not credit a coding agent as a co-author (see AGENTS.md). Remove:\n${found.join('\n')}`
    );
    process.exitCode = 1;
  }
}
