'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseStoredValue } = require('../server/lib/featureSettings');

describe('featureSettings.parseStoredValue', () => {
  it('herkent true-varianten', () => {
    assert.equal(parseStoredValue('true'), true);
    assert.equal(parseStoredValue('TRUE'), true);
    assert.equal(parseStoredValue('1'), true);
    assert.equal(parseStoredValue('yes'), true);
    assert.equal(parseStoredValue('on'), true);
  });

  it('herkent false-varianten', () => {
    assert.equal(parseStoredValue('false'), false);
    assert.equal(parseStoredValue('0'), false);
    assert.equal(parseStoredValue('no'), false);
    assert.equal(parseStoredValue('off'), false);
  });

  it('null / leeg → null', () => {
    assert.equal(parseStoredValue(null), null);
    assert.equal(parseStoredValue(''), null);
    assert.equal(parseStoredValue('   '), null);
  });

  it('onzin → null', () => {
    assert.equal(parseStoredValue('maybe'), null);
  });
});
