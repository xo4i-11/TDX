// Tests that formSignature is stable across reloads, blind to URL noise, and sensitive to real structural change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers.ts';
import { formSignature } from '../src/core/signature.ts';

const docFrom = (html: string): Document => new JSDOM(html).window.document;

test('the same form yields the same signature every time', () => {
  assert.equal(formSignature(loadFixture()), formSignature(loadFixture()));
});

test('the signature ignores URL-carried session and app ids', () => {
  // Signatures are computed from markup only; nothing here reads location.
  const doc = loadFixture();
  const before = formSignature(doc);
  doc.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', 'https://example.test/?U=changed'));
  assert.equal(formSignature(doc), before);
});

test('adding a field changes the signature, because a learned mapping should be revalidated', () => {
  const base = '<form><div class="form-group" data-fieldid="37"></div><input name="ParentFormID" value="162"></form>';
  const grown = '<form><div class="form-group" data-fieldid="37"></div><div class="form-group" data-fieldid="99"></div><input name="ParentFormID" value="162"></form>';
  assert.notEqual(formSignature(docFrom(base)), formSignature(docFrom(grown)));
});

test('field order does not change the signature', () => {
  const a = '<form><div data-fieldid="37"></div><div data-fieldid="99"></div><input name="ParentFormID" value="162"></form>';
  const b = '<form><div data-fieldid="99"></div><div data-fieldid="37"></div><input name="ParentFormID" value="162"></form>';
  assert.equal(formSignature(docFrom(a)), formSignature(docFrom(b)));
});

test('a different parent form id yields a different signature', () => {
  const a = '<form><div data-fieldid="37"></div><input name="ParentFormID" value="162"></form>';
  const b = '<form><div data-fieldid="37"></div><input name="ParentFormID" value="999"></form>';
  assert.notEqual(formSignature(docFrom(a)), formSignature(docFrom(b)));
});

test('a document with no markers still yields a stable string', () => {
  const sig = formSignature(docFrom('<form><input name="x"></form>'));
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 0);
});

// Without a fallback the signature of a marker-less form is just the parent
// form id, so an administrator could add or remove fields without invalidating
// a learned mapping — the opposite of what the README promises.
test('a marker-less form still changes signature when a field is added or removed', () => {
  const one = '<form><input name="ParentFormID" value="162"><input name="a"></form>';
  const two = '<form><input name="ParentFormID" value="162"><input name="a"><input name="b"></form>';
  assert.notEqual(formSignature(docFrom(one)), formSignature(docFrom(two)));
  assert.equal(formSignature(docFrom(two)), formSignature(docFrom(two)), 'and is still stable');
});
