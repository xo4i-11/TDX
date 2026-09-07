// Tests that harvest finds every fillable control on the TDX form and captures its identifying signals correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Control } from '../src/types.ts';
import { loadFixture, loadUnknownFormFixture, loadUpdateFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';

function find(controls: Control[], id: string): Control | undefined {
  return controls.find((c) => c.id === id || c.lookup?.hidden.id === id);
}

test('harvests the fixture without throwing and finds a plausible number of controls', () => {
  const controls = harvest(loadFixture());
  assert.ok(controls.length >= 15, `expected 15+ controls, got ${controls.length}`);
});

test('a lookup is one control carrying its hidden, visible, and reset elements', () => {
  const controls = harvest(loadFixture());
  const service = find(controls, 'attribute789');
  assert.ok(service, 'service lookup not harvested');
  assert.equal(service.shape, 'lookup');
  assert.ok(service.lookup);
  assert.equal(service.lookup.hidden.id, 'attribute789');
  assert.equal(service.lookup.input.id, 'attribute789_input');
  assert.equal(service.lookup.reset?.id, 'attribute789_reset');
  assert.equal(service.label, 'Service');
});

test('the visible half of a lookup is not also harvested as a separate text control', () => {
  const controls = harvest(loadFixture());
  const strays = controls.filter((c) => c.id?.endsWith('_input'));
  assert.deepEqual(strays, [], 'lookup input surfaced as its own control');
});

test('native selects carry their option texts', () => {
  const controls = harvest(loadFixture());
  const source = find(controls, 'attribute371');
  assert.ok(source);
  assert.equal(source.shape, 'select');
  assert.ok(source.options.includes('Walkup'));
  assert.equal(source.label, 'Source');
});

test('select2 controls are classified distinctly from native selects', () => {
  const controls = harvest(loadFixture());
  const affiliation = find(controls, 'attribute2706');
  assert.ok(affiliation);
  assert.equal(affiliation.shape, 'select2');
  assert.ok(affiliation.options.includes('Student'));
});

test('the description is harvested as richtext with its CKEditor instance key', () => {
  const controls = harvest(loadFixture());
  const description = controls.find((c) => c.shape === 'richtext');
  assert.ok(description);
  assert.ok(description.richtext);
  assert.equal(description.richtext.instanceKey, 'attribute138_Content');
  assert.equal(description.label, 'Description');
});

test('TDX semantic markers are captured when present', () => {
  const controls = harvest(loadFixture());
  const summary = find(controls, 'attribute37');
  assert.ok(summary);
  assert.equal(summary.fieldType, 'title');
  assert.equal(summary.fieldId, '37');
});

test('harvest still finds controls and labels when the markers are gone', () => {
  const controls = harvest(loadUnknownFormFixture());
  const summary = find(controls, 'attribute37');
  assert.ok(summary);
  assert.equal(summary.fieldType, null);
  assert.equal(summary.fieldId, null);
  assert.equal(summary.label, 'Brief Summary', 'label must survive marker removal');
});

test('hidden, submit, button, and file controls are excluded', () => {
  const controls = harvest(loadFixture());
  for (const c of controls) {
    if (c.shape !== 'lookup') {
      const type = c.el.getAttribute('type');
      assert.ok(!['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type ?? ''), `${c.id} type=${type}`);
    }
  }
});

test('control keys are unique and stable across two harvests of the same document', () => {
  const doc = loadFixture();
  const a = harvest(doc).map((c) => c.key);
  const b = harvest(doc).map((c) => c.key);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test('the private-comment checkbox on the update form is harvested as a checkbox', () => {
  const control = harvest(loadUpdateFixture()).find((c) => c.id === 'CommentsIsPrivate');
  assert.ok(control, 'CommentsIsPrivate was not harvested at all');
  assert.equal(control.shape, 'checkbox');
});

// Falsifiability: radios stay skipped. The update form has three
// KnowledgeBaseArticleOption radios that must not become fillable controls.
test('radios are still skipped', () => {
  const radios = harvest(loadUpdateFixture()).filter((c) => (c.el as HTMLInputElement).type === 'radio');
  assert.deepEqual(radios, []);
});
