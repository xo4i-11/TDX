// Tests that applyValue/currentValue route a harvested control to the adapter matching its shape, and that an unrecognised shape is reported rather than thrown or silently accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { applyValue, currentValue } from '../src/adapters/index.ts';
import type { Control } from '../src/types.ts';

const controls = (): Control[] => harvest(loadFixture());
const byId = (id: string): Control => {
  const control = controls().find((c) => c.id === id || c.lookup?.hidden.id === id);
  assert.ok(control, `expected a control for ${id}`);
  return control;
};
const bridge = { async setEditorData() { return { ok: false, detail: 'no instance in jsdom' }; } };

test('a text control routes to the text adapter', async () => {
  const result = await applyValue(byId('attribute2445'), 'duynghie', { bridge });
  assert.equal(result.status, 'filled');
});

test('a native select routes to the select adapter', async () => {
  const control = byId('attribute371');
  const result = await applyValue(control, 'Walkup', { bridge });
  assert.equal(result.status, 'filled');
  assert.equal(currentValue(control), 'Walkup');
});

test('a lookup routes to the lookup adapter and takes an {id,text} pair', async () => {
  const control = byId('attribute789');
  const result = await applyValue(control, { id: '288', text: 'Personal Device Consultation' }, { bridge });
  assert.equal(result.status, 'filled');
  assert.ok(control.lookup);
  assert.equal(control.lookup.hidden.value, '288');
});

test('a richtext control routes to the rich-text adapter', async () => {
  const control = controls().find((c) => c.shape === 'richtext');
  assert.ok(control);
  const result = await applyValue(control, '<p>notes</p>', { bridge });
  assert.equal(result.status, 'filled');
});

test('select2 has no write path and says so instead of half-working', async () => {
  const control = byId('attribute2706');
  const result = await applyValue(control, 'Student', { bridge });
  assert.equal(result.status, 'skipped');
  assert.match(result.detail, /select2/i);
});

test('an unknown shape reports skipped rather than throwing', async () => {
  const bogus = { shape: 'sorcery', key: 'x' } as unknown as Control;
  const result = await applyValue(bogus, 'v', { bridge });
  assert.equal(result.status, 'skipped');
  assert.match(result.detail, /sorcery/);
});

test('currentValue works for every shape the fixture contains', () => {
  assert.equal(typeof currentValue(byId('attribute2445')), 'string');
  assert.equal(typeof currentValue(byId('attribute371')), 'string');
  assert.equal(typeof currentValue(byId('attribute789')), 'string');
  const richtext = controls().find((c) => c.shape === 'richtext');
  assert.ok(richtext);
  assert.equal(typeof currentValue(richtext), 'string');
});
