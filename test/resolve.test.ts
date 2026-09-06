// Tests that resolve() maps harvested controls onto canonical fields correctly, in tier order, on both the real form and one with TDX's markers stripped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUnknownFormFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve, LOW_CONFIDENCE } from '../src/core/resolve.ts';
import { FILL_SET } from '../src/core/dictionary.ts';
import type { Resolution } from '../src/types.ts';

function resolveDoc(doc: Document, learned?: Record<string, string>): Resolution {
  return resolve(harvest(doc), learned ? { learned } : {});
}

test('every fill-set field resolves on the real form, via TDX markers', () => {
  const { byField } = resolveDoc(loadFixture());
  for (const key of FILL_SET) {
    const match = byField.get(key);
    assert.ok(match, `${key} did not resolve`);
    assert.ok(match.tier === 1 || match.tier === 2, `${key} expected tier 1 or 2, got ${match.tier}`);
    assert.ok(match.confidence >= 0.9, `${key} confidence ${match.confidence}`);
  }
});

test('fill-set fields land on the right controls', () => {
  const { byField } = resolveDoc(loadFixture());
  assert.equal(byField.get('ubitName')?.control.id, 'attribute2445');
  assert.equal(byField.get('briefSummary')?.control.id, 'attribute37');
  assert.equal(byField.get('source')?.control.id, 'attribute371');
  assert.equal(byField.get('description')?.control.richtext?.instanceKey, 'attribute138_Content');
  assert.equal(byField.get('service')?.control.lookup?.hidden.id, 'attribute789');
});

test('ACCEPTANCE: an unseen form resolves the fill set from labels and options alone', () => {
  // No data-fieldtype, no data-fieldid. Only labels, option sets, names, ids.
  const { byField } = resolveDoc(loadUnknownFormFixture());
  for (const key of FILL_SET) {
    const match = byField.get(key);
    assert.ok(match, `${key} did not resolve without TDX markers`);
    assert.equal(match.tier, 3);
    assert.ok(match.confidence > LOW_CONFIDENCE, `${key} confidence ${match.confidence}`);
  }
  assert.equal(byField.get('ubitName')?.control.id, 'attribute2445');
  assert.equal(byField.get('briefSummary')?.control.id, 'attribute37');
  assert.equal(byField.get('description')?.control.richtext?.instanceKey, 'attribute138_Content');
  assert.equal(byField.get('source')?.control.id, 'attribute371');
});

test('Service and Service Offering do not collide', () => {
  const { byField } = resolveDoc(loadUnknownFormFixture());
  const service = byField.get('service')?.control.lookup?.hidden.id;
  const offering = byField.get('serviceOffering')?.control.lookup?.hidden.id;
  assert.equal(service, 'attribute789');
  assert.equal(offering, 'attribute1932');
});

test('one control is never assigned to two fields', () => {
  const { byField } = resolveDoc(loadFixture());
  const used = [...byField.values()].map((m) => m.control.key);
  assert.equal(new Set(used).size, used.length);
});

test('option sets alone identify Impact even when its label is wrong', () => {
  const doc = loadUnknownFormFixture();
  const label = doc.querySelector('label[for="attribute369"]');
  assert.ok(label);
  label.textContent = 'Widget Severity Level';
  const { byField } = resolveDoc(doc);
  assert.equal(byField.get('impact')?.control.id, 'attribute369');
});

test('a learned mapping wins over scoring and reports tier 0', () => {
  const learned = { attribute2390: 'briefSummary' };
  const { byField } = resolveDoc(loadFixture(), learned);
  const match = byField.get('briefSummary');
  assert.ok(match);
  assert.equal(match.control.id, 'attribute2390');
  assert.equal(match.tier, 0);
  assert.equal(match.confidence, 1);
});

test('diagnostics reports a winner and runners-up for every harvested control', () => {
  const { diagnostics } = resolveDoc(loadFixture());
  assert.equal(diagnostics.length, harvest(loadFixture()).length);
  const summary = diagnostics.find((d) => d.control.id === 'attribute37');
  assert.ok(summary);
  assert.equal(summary.winner?.fieldKey, 'briefSummary');
  assert.ok(Array.isArray(summary.runnersUp));
  assert.ok(summary.runnersUp.length <= 3);
  assert.ok(summary.runnersUp.every((r) => r.fieldKey !== 'briefSummary'));
});

test('fields absent from the form are reported unresolved rather than mismatched', () => {
  const { unresolvedFields, byField } = resolveDoc(loadFixture());
  // This form has no Classification field; whatever is missing must be listed,
  // and must not have been forced onto some unrelated control.
  for (const key of unresolvedFields) assert.equal(byField.has(key), false);
});

test('resolution is deterministic', () => {
  const a = [...resolveDoc(loadFixture()).byField.entries()].map(([k, m]) => `${k}:${m.control.key}:${m.tier}`);
  const b = [...resolveDoc(loadFixture()).byField.entries()].map(([k, m]) => `${k}:${m.control.key}:${m.tier}`);
  assert.deepEqual(a, b);
});
