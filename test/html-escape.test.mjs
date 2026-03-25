import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml } from '../public/js/escape-html.js';
import { renderExerciseMarkdown } from '../public/js/markdown-render.js';

test('escHtml escapes &, <, >, "', () => {
  assert.equal(escHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
});

test('escHtml handles nullish', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
});

test('renderExerciseMarkdown without browser libs escapes dangerous markup', () => {
  const out = renderExerciseMarkdown('<script>alert(1)</script>');
  assert.ok(!out.includes('<script'));
  assert.match(out, /&lt;script/);
});

test('renderExerciseMarkdown empty input', () => {
  assert.equal(renderExerciseMarkdown(''), '');
  assert.equal(renderExerciseMarkdown('   '), '');
});
