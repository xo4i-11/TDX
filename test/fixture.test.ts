// Checks the saved TDX form still carries every signal the resolver reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUnknownFormFixture } from './helpers.ts';

test('fixture carries the TDX semantic markers the resolver depends on', () => {
  const doc = loadFixture();
  const types = [...doc.querySelectorAll('[data-fieldtype]')]
    .map((el) => el.getAttribute('data-fieldtype'));
  for (const expected of ['requestor', 'title', 'description', 'source', 'service']) {
    assert.ok(types.includes(expected), `missing data-fieldtype="${expected}"`);
  }
});

test('fixture carries the custom-attribute ids the resolver depends on', () => {
  const doc = loadFixture();
  assert.ok(doc.querySelector('[data-fieldid="2445"]'), 'missing UBITName group 2445');
  assert.ok(doc.querySelector('[data-fieldid="2706"]'), 'missing Affiliation group 2706');
});

test('fixture carries the Walkup option and the lookup triple', () => {
  const doc = loadFixture();
  const sourceOptions = [...doc.querySelectorAll('#attribute371 option')].map((o) => o.textContent.trim());
  assert.ok(sourceOptions.includes('Walkup'));
  assert.ok(doc.querySelector('#attribute789'), 'service hidden input');
  assert.ok(doc.querySelector('#attribute789_input'), 'service visible input');
  assert.ok(doc.querySelector('#attribute789_reset'), 'service reset input');
});

test('fixture contains no session credential', () => {
  const doc = loadFixture();
  const token = doc.querySelector('[name="__RequestVerificationToken"]');
  assert.equal(token?.getAttribute('value'), 'REDACTED');
});

test('unknown-form fixture has no TDX semantic markers left', () => {
  const doc = loadUnknownFormFixture();
  assert.equal(doc.querySelectorAll('[data-fieldtype]').length, 0);
  assert.equal(doc.querySelectorAll('[data-fieldid]').length, 0);
  assert.ok(doc.querySelector('#attribute37'), 'controls themselves must survive');
});
