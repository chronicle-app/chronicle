// Finds where validation issues sit in the pasted text, so the validator page
// can mark them. JSON.parse keeps no positions; jsonc-parser's tree does.
import { findNodeAtLocation, parseTree, printParseErrorCode } from 'jsonc-parser';

const OPTIONS = { disallowComments: true, allowTrailingComma: false };

/** The line and column, from 1, of an offset in `text`. */
export function lineAndColumn(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, column: before.at(-1).length + 1 };
}

/** Where reading `text` as JSON first fails, if it does. */
export function parseFailure(text) {
  const errors = [];
  parseTree(text, errors, OPTIONS);
  const [error] = errors;
  if (!error) return null;
  return {
    offset: error.offset,
    length: Math.max(error.length, 1),
    code: printParseErrorCode(error.error),
    ...lineAndColumn(text, error.offset),
  };
}

// A record is marked by its @type field, or its opening brace without one.
function recordRange(node) {
  if (node.type !== 'object') return { offset: node.offset, length: node.length };
  const type = node.children?.find(property => property.children?.[0]?.value === '@type');
  return type ? { offset: type.offset, length: type.length } : { offset: node.offset, length: 1 };
}

/**
 * The text range of each issue from validateRecords: a value, a whole field
 * (`target: 'field'`), or the record a missing part belongs to (`target:
 * 'record'`). Issues that cannot be found get null.
 */
export function locateIssues(text, issues) {
  const root = parseTree(text, [], OPTIONS);
  if (!root) return issues.map(() => null);
  return issues.map(issue => {
    const node = findNodeAtLocation(root, issue.location);
    if (!node) return null;
    if (issue.target === 'record') return recordRange(node);
    const property = node.parent?.type === 'property' ? node.parent : null;
    if (issue.target === 'field' && property)
      return { offset: property.offset, length: property.length };
    return { offset: node.offset, length: node.length };
  });
}
