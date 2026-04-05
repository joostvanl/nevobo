const test = require('node:test');
const assert = require('node:assert');
const {
  getBuiltInDefaultConfig,
  validateConfig,
  composeBuiltInPrompt,
  getActiveSystemPrompt,
} = require('../server/lib/training-ai-prompts.js');

test('built-in default config validates', () => {
  const cfg = getBuiltInDefaultConfig();
  assert.strictEqual(validateConfig(cfg), null);
});

test('composeBuiltInPrompt differs per mode', () => {
  const a = composeBuiltInPrompt('new');
  const b = composeBuiltInPrompt('optimize');
  assert.ok(a.includes('VOLLEDIG NIEUW'));
  assert.ok(b.includes('OPTIMALISEREN'));
  assert.notStrictEqual(a, b);
});

test('getActiveSystemPrompt appends venue unavailability rules', () => {
  const p = getActiveSystemPrompt('complete');
  assert.ok(p.includes('venue_unavailability'));
  assert.ok(p.includes('R9'));
  assert.ok(p.includes('V10 HUUR'));
});
