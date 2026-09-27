import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeEntities,
  htmlToMarkdown,
  htmlToText,
  looksLikeHtml,
  tokenizeHtml,
} from '../dist/index.js';

// All markup here is synthetic.
const textOf = tokens => tokens.map(token => (token.kind === 'text' ? token.value : '')).join('');

test('decodeEntities reads references it knows and leaves the rest as written', () => {
  assert.equal(decodeEntities('&amp;&nbsp;&rsquo;&#8212;&#x2014;'), '& ’——');
  assert.equal(decodeEntities('a &frobnicate; b'), 'a &frobnicate; b');
  assert.equal(decodeEntities('&#xD800;'), '&#xD800;');
  assert.equal(decodeEntities('&#99999999;'), '&#99999999;');
});

test('tokenizeHtml reads attributes, closes void elements, and skips comments and scripts', () => {
  assert.deepEqual(
    [...tokenizeHtml('<a href="/x" title="a > b">hi</a>')],
    [
      { kind: 'open', name: 'a', attrs: { href: '/x', title: 'a > b' }, selfClosing: false },
      { kind: 'text', value: 'hi' },
      { kind: 'close', name: 'a' },
    ]
  );
  assert.deepEqual(
    [...tokenizeHtml('<br>')].map(token => token.kind),
    ['open', 'close']
  );
  assert.equal(textOf([...tokenizeHtml('a<!-- note -->b<script>evil()</script>c')]), 'abc');

  // A tag name cannot contain a colon, so `https` never completes a match.
  const bare = [...tokenizeHtml('see <https://example.com/a> ok')];
  assert.ok(bare.every(token => token.kind === 'text'));
  assert.equal(textOf(bare), 'see <https://example.com/a> ok');

  assert.doesNotThrow(() => [...tokenizeHtml('<p>text <not a tag')]);
});

test('looksLikeHtml separates markup from text that merely has angle brackets', () => {
  assert.equal(looksLikeHtml('<p>hi</p>'), true);
  assert.equal(looksLikeHtml('a < b and b > c'), false);
  assert.equal(looksLikeHtml('mail <https://example.com>'), false);
});

test('htmlToText renders what a reader saw', () => {
  const cases = [
    [
      '<p class="editor">Hi there!</p><p class="editor"><br></p><p class="editor">How can we help?</p>',
      'Hi there!\n\nHow can we help?',
    ],
    [
      '<p>Click <a href="https://example.com/x">here</a>.</p>',
      'Click here (https://example.com/x).',
    ],
    [
      '<p>our<a href="https://e.com/j"> Engineer</a> role</p>',
      'our Engineer (https://e.com/j) role',
    ],
    ['<a href="https://e.com/i?utm=x">https://e.com/i</a>', 'https://e.com/i?utm=x'],
    ['<ul><li>First</li><li>Second</li></ul>', 'First\nSecond'],
    ['<p>A <strong>bold</strong> and <em>italic</em> claim</p>', 'A bold and italic claim'],
    ['<p>Tom&nbsp;&amp; Jerry&rsquo;s &bull; caf&eacute;</p>', 'Tom & Jerry’s • café'],
    // No markup: the blank lines are the author's, not an artifact.
    ["Hey,\n\n\nI've been out of the loop.", "Hey,\n\n\nI've been out of the loop."],
  ];
  for (const [html, text] of cases) assert.equal(htmlToText(html), text, html);

  assert.equal(htmlToText(''), undefined);
  assert.equal(htmlToText(), undefined);
  assert.equal(htmlToText('<p><br></p>'), undefined);
});

test('htmlToMarkdown keeps structure and escapes only what it must', () => {
  const cases = [
    [
      '<h2>Title</h2><p>A <strong>bold</strong> <em>claim</em>.</p>',
      '## Title\n\nA **bold** *claim*.',
    ],
    ['<p>Read <a href="https://e.com/x">more</a>.</p>', 'Read [more](https://e.com/x).'],
    ['<p><img src="/a.png" alt="A chart"></p>', '![A chart](/a.png)'],
    [
      '<ol><li>First</li><li>Second<ul><li>Inner</li></ul></li><li>Third</li></ol>',
      '1. First\n2. Second\n  - Inner\n3. Third',
    ],
    ['<ol start="3"><li>Third</li><li>Fourth</li></ol>', '3. Third\n4. Fourth'],
    ['<blockquote><p>Outer</p><blockquote>Inner</blockquote></blockquote>', '> Outer\n\n> > Inner'],
    ['<pre><code>const a = b * c;</code></pre>', '```\nconst a = b * c;\n```'],
    ['<p>One<br>Two</p>', 'One  \nTwo'],
    ['<p>Costs 5 * 3 and [see] `this`</p>', 'Costs 5 \\* 3 and \\[see\\] \\`this\\`'],
    ['<p>call snake_case_name then _this_</p>', String.raw`call snake_case_name then \_this\_`],
    [
      '<p># not a heading</p><p>- not a bullet</p>',
      String.raw`\# not a heading` + '\n\n' + String.raw`\- not a bullet`,
    ],
    // A plain-text body is already what someone typed.
    ['5 * 3 = 15', '5 * 3 = 15'],
  ];
  for (const [html, markdown] of cases) assert.equal(htmlToMarkdown(html), markdown, html);

  assert.equal(htmlToMarkdown(''), undefined);
  assert.equal(htmlToMarkdown('<p></p>'), undefined);
});
