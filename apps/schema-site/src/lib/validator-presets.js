// Records that fail validation, or pass with a warning, for the validator
// page. Like the examples, the people, accounts, and identifiers are made up.
const key = ['@type', 'source', 'sourceId'];

export const FAILING_PRESETS = [
  {
    id: 'missing-identity',
    title: 'Missing identity',
    value: { '@type': 'Entity', name: 'Missing identity' },
  },
  {
    id: 'nested-missing-identity',
    title: 'Nested record without identity',
    value: {
      '@type': 'MessageAction',
      '@key': key,
      source: 'imessage',
      sourceId: 'msg-2041',
      timestamp: '2026-05-04T18:12:00Z',
      object: { '@type': 'Message', body: 'On my way' },
    },
  },
  {
    id: 'unknown-class',
    title: 'Class not in the vocabulary',
    value: {
      '@type': 'ReadAction',
      '@key': key,
      source: 'goodreads',
      sourceId: 'review-88',
      timestamp: '2026-02-11T21:40:00Z',
    },
  },
  {
    id: 'wrong-values',
    title: 'Wrong kinds of values',
    value: {
      '@type': 'CompleteAction',
      '@key': key,
      source: 'things-todo',
      sourceId: 'done-311',
      timestamp: 'last Tuesday',
      agent: 'Sam',
      object: {
        '@type': 'Task',
        '@key': key,
        source: 'things-todo',
        sourceId: 'task-311',
        name: 'Renew passport',
        url: 'renew passport',
      },
    },
  },
  {
    id: 'undeclared-field',
    title: 'Undeclared field',
    value: {
      '@type': 'Task',
      '@key': key,
      source: 'things-todo',
      sourceId: 'task-312',
      name: 'Book dentist',
      priority: 'high',
    },
  },
];
