// Tests that the field dictionary has the right shape and covers every canonical field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARY, FILL_SETS, byKey } from '../src/core/dictionary.ts';

test('every entry has the required shape', () => {
  for (const def of DICTIONARY) {
    assert.equal(typeof def.key, 'string', 'key');
    assert.equal(typeof def.label, 'string', `${def.key} label`);
    assert.ok(['text', 'select', 'lookup', 'richtext', 'checkbox'].includes(def.control), `${def.key} control`);
    assert.ok(Array.isArray(def.fieldTypes), `${def.key} fieldTypes`);
    assert.ok(Array.isArray(def.fieldIds), `${def.key} fieldIds`);
    assert.ok(Array.isArray(def.labels), `${def.key} labels`);
    assert.ok(Array.isArray(def.patterns), `${def.key} patterns`);
    assert.ok(Array.isArray(def.options), `${def.key} options`);
  }
});

test('keys are unique', () => {
  const keys = DICTIONARY.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

// Order matters twice over: Service before its dependent Offering, and
// unchecking "private" before the comment that unchecking makes visible.
test('the fill sets are exactly the writable fields of each mode, in order', () => {
  assert.deepEqual(FILL_SETS.create, ['ubitName', 'briefSummary', 'description', 'source', 'service', 'serviceOffering']);
  assert.deepEqual(FILL_SETS.resolve, ['newStatus', 'commentsPrivate', 'comments']);
});

test('every fill-set key exists in the dictionary and is not marked neverWrite', () => {
  for (const key of [...FILL_SETS.create, ...FILL_SETS.resolve]) {
    const def = byKey(key);
    assert.ok(def, `${key} missing from dictionary`);
    assert.notEqual(def?.neverWrite, true, `${key} must be writable`);
  }
});

test('affiliation is present, resolvable, and marked neverWrite', () => {
  const aff = byKey('affiliation');
  assert.ok(aff);
  assert.equal(aff?.neverWrite, true);
  assert.ok(!FILL_SETS.create.includes('affiliation'));
  assert.ok(!FILL_SETS.resolve.includes('affiliation'));
});

test('source carries the exact TDX option string as its fixed value', () => {
  assert.equal(byKey('source')?.fixedValue, 'Walkup');
  assert.ok(byKey('source')?.options.includes('Walkup'));
});

test('impact and urgency carry their real option strings, which are their strongest signal', () => {
  assert.ok(byKey('impact')?.options.includes('Low - Affects User'));
  assert.ok(byKey('urgency')?.options.includes('High - Impacting work'));
});

test('the dictionary covers every canonical field named in the spec', () => {
  const required = [
    'requestor', 'department', 'alternativeContact', 'affiliation', 'ubitName',
    'briefSummary', 'description', 'location', 'locationRoom', 'deviceType',
    'macAddress', 'ipAddress', 'operatingSystem', 'osVersion', 'assetId',
    'status', 'responsible', 'source', 'impact', 'urgency', 'service',
    'serviceOffering', 'additionalInformation',
    'newStatus', 'comments', 'commentsPrivate', 'responsible',
  ];
  const keys = new Set(DICTIONARY.map((d) => d.key));
  for (const key of required) assert.ok(keys.has(key), `missing canonical field: ${key}`);
});
