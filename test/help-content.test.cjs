'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HELP_DIR = path.join(__dirname, '..', 'public', 'help');

const BLOCK_TYPES = new Set(['p', 'ul', 'table', 'callout', 'code']);

function readJson(name) {
  const p = path.join(HELP_DIR, name);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function validateBlock(b, ctx) {
  assert.ok(b && typeof b === 'object', `${ctx}: block object`);
  assert.ok(BLOCK_TYPES.has(b.type), `${ctx}: onbekend block type ${b.type}`);
  if (b.type === 'p' || b.type === 'code') assert.ok(typeof b.text === 'string', `${ctx}: text string`);
  if (b.type === 'ul') assert.ok(Array.isArray(b.items), `${ctx}: ul.items`);
  if (b.type === 'table') {
    assert.ok(Array.isArray(b.headers), `${ctx}: table.headers`);
    assert.ok(Array.isArray(b.rows), `${ctx}: table.rows`);
  }
  if (b.type === 'callout') {
    assert.ok(typeof b.text === 'string', `${ctx}: callout.text`);
    if (b.variant) assert.ok(['note', 'warning'].includes(b.variant), `${ctx}: callout.variant`);
  }
}

describe('public/help content', () => {
  it('manifest.json is geldig', () => {
    const m = readJson('manifest.json');
    assert.ok(m.version, 'version');
    assert.ok(Array.isArray(m.collections), 'collections');
    const ids = new Set();
    for (const c of m.collections) {
      assert.ok(c.id && typeof c.id === 'string', 'collection.id');
      assert.ok(!ids.has(c.id), `dubbele collection id: ${c.id}`);
      ids.add(c.id);
      assert.ok(c.title, 'collection.title');
      assert.ok(c.path && c.path.startsWith('/help/'), 'collection.path');
      if (c.requiresRole) {
        assert.ok(['authenticated', 'admin', 'super_admin'].includes(c.requiresRole), 'requiresRole');
      }
    }
  });

  it('functional.nl.json is geldig', () => {
    const data = readJson('functional.nl.json');
    assert.ok(data.meta?.title, 'meta.title');
    assert.ok(Array.isArray(data.chapters), 'chapters');
    const chapterIds = new Set();
    const sectionIds = new Set();
    for (const ch of data.chapters) {
      assert.ok(ch.id && ch.title, 'chapter id/title');
      assert.ok(!chapterIds.has(ch.id), `dubbel chapter id ${ch.id}`);
      chapterIds.add(ch.id);
      assert.ok(Array.isArray(ch.sections), 'sections');
      for (const sec of ch.sections) {
        assert.ok(sec.id && sec.title, 'section id/title');
        const key = `${ch.id}/${sec.id}`;
        assert.ok(!sectionIds.has(key), `dubbele section id ${key}`);
        sectionIds.add(key);
        assert.ok(Array.isArray(sec.blocks), 'blocks');
        sec.blocks.forEach((b, i) => validateBlock(b, `chapter ${ch.id} section ${sec.id} block[${i}]`));
      }
    }
  });

  it('admin-manual.nl.json is geldig', () => {
    const data = readJson('admin-manual.nl.json');
    assert.ok(data.meta?.title, 'meta.title');
    assert.ok(Array.isArray(data.guides), 'guides');
    const guideIds = new Set();
    for (const g of data.guides) {
      assert.ok(g.id && g.title, 'guide id/title');
      assert.ok(!guideIds.has(g.id), `dubbele guide id ${g.id}`);
      guideIds.add(g.id);
      assert.ok(Array.isArray(g.audience) && g.audience.length, 'guide.audience');
      assert.ok(Array.isArray(g.steps), 'steps');
      const stepNums = new Set();
      for (const st of g.steps) {
        assert.ok(Number.isInteger(st.n), 'step.n');
        assert.ok(!stepNums.has(st.n), `dubbele stap ${st.n} in guide ${g.id}`);
        stepNums.add(st.n);
        assert.ok(st.title, 'step.title');
        assert.ok(Array.isArray(st.body), 'step.body');
        st.body.forEach((b, i) => validateBlock(b, `guide ${g.id} step ${st.n} block[${i}]`));
      }
    }
  });
});
