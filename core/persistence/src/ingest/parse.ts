/**
 * Parse a payload stream into individual action payloads. Accepts, in order of
 * tolerance:
 *  - a single JSON object,
 *  - a JSON array of objects,
 *  - JSONL (one object per line),
 *  - concatenated pretty-printed JSON objects (what Chronicle plugins emit on
 *    stdout via the JSON loader).
 *
 * Arrays are flattened, so any mix yields a flat list of payloads.
 */
export function parsePayloadStream(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];

  // Fast path: the whole input is one JSON value.
  try {
    const value = JSON.parse(trimmed);
    return Array.isArray(value) ? value : [value];
  } catch {
    // fall through to multi-value scanning
  }

  const values = splitTopLevel(trimmed).map(chunk => JSON.parse(chunk));
  return values.flatMap(v => (Array.isArray(v) ? v : [v]));
}

/**
 * Split a string of concatenated top-level JSON values (objects/arrays) into
 * individual JSON substrings. String- and escape-aware so braces inside string
 * literals don't confuse the depth counter.
 */
function splitTopLevel(text: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (start === -1) {
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
      start = i;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    switch (ch) {
      case '"':
        inString = true;
        break;
      case '{':
      case '[':
        depth++;
        break;
      case '}':
      case ']':
        depth--;
        if (depth === 0) {
          chunks.push(text.slice(start, i + 1));
          start = -1;
        }
        break;
      default:
        break;
    }
  }

  if (chunks.length === 0) {
    throw new SyntaxError('Could not parse any JSON value from input');
  }
  return chunks;
}
