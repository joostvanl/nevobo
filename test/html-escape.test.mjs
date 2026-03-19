import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml } from '../public/js/escape-html.js';

test('escHtml escapes &, <, >, "', () => {
  assert.equal(escHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
});

test('escHtml handles nullish', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
});
