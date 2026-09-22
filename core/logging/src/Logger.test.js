import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { createLogger, Logger } from '../dist/index.js';

const theme = Object.fromEntries(
  ['debug', 'info', 'warn', 'error'].map(level => [level, text => text])
);

afterEach(() => mock.restoreAll());

function capture() {
  const output = [];
  mock.method(process.stderr, 'write', text => {
    output.push(text);
    return true;
  });
  const stdout = mock.method(process.stdout, 'write', () => true);
  return { output, stdout };
}

test('factory writes prefix and structured context only to stderr', () => {
  const { output, stdout } = capture();
  const logger = createLogger({ prefix: '[extract]', theme });
  assert.ok(logger instanceof Logger);
  logger.info('Read records', { count: 3 });
  assert.equal(output.join(''), `${'extract'.padEnd(25)} Read records {"count":3}\n`);
  assert.equal(stdout.mock.callCount(), 0);
});

test('quiet suppresses verbose, info, and warnings but preserves errors', () => {
  const { output } = capture();
  const logger = new Logger({ quiet: true, verbose: true, theme });
  logger.debug('debug');
  logger.debugMultiline('details', { count: 1 });
  logger.verboseInfo('verbose');
  logger.info('info');
  logger.warn('warn');
  logger.error('failed');
  assert.equal(output.length, 1);
  assert.match(output[0], /failed\n$/);
});

test('level filters ordinary messages and debug requires verbose', () => {
  const { output } = capture();
  const logger = new Logger({ level: 'warn', theme });
  logger.info('hidden');
  logger.debug('hidden debug');
  logger.verboseInfo('hidden verbose');
  logger.warn('visible');
  logger.error('failure');
  assert.equal(output.length, 2);
  assert.match(output[0], /visible\n$/);
  assert.match(output[1], /failure\n$/);
});

test('verbose output keeps arrays compact in multiline context', () => {
  const { output } = capture();
  const logger = new Logger({ verbose: true, theme });
  logger.debugMultiline('details', { nested: { count: 2 }, ids: [1, 2] });
  logger.verboseInfo('progress');
  assert.match(output[0], /"nested": \{\n {4}"count": 2\n {2}\}/);
  assert.match(output[0], /"ids": \[1,2\]/);
  assert.match(output[1], /progress\n$/);
});

test('default theme emits no ANSI colors when stderr is a pipe', () => {
  const { output } = capture();
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  try {
    new Logger().info('plain');
    assert.equal(output.join('').includes(String.fromCodePoint(27)), false);
  } finally {
    if (descriptor) Object.defineProperty(process.stderr, 'isTTY', descriptor);
    else delete process.stderr.isTTY;
  }
});
