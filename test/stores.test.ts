// Tests that the four stores round-trip through a chrome.storage-shaped double, dedupe by id, keep learned mappings per form signature, and never persist requestor data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStores, createMemoryArea, DEFAULT_SETTINGS } from '../src/data/stores.ts';

const fresh = () => createStores(createMemoryArea());

test('settings start at their defaults and patch without clobbering', async () => {
  const stores = fresh();
  assert.deepEqual(await stores.settings.get(), DEFAULT_SETTINGS);
  await stores.settings.patch({ collapsed: true });
  assert.equal((await stores.settings.get()).collapsed, true);
});

test('templates round-trip and are replaced by id, not duplicated', async () => {
  const stores = fresh();
  await stores.templates.save({ id: 'a', name: 'One', summary: 's', descriptionHtml: '<p>x</p>', service: null });
  await stores.templates.save({ id: 'a', name: 'One edited', summary: 's', descriptionHtml: '<p>x</p>', service: null });
  const list = await stores.templates.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'One edited');
});

test('templates can be removed', async () => {
  const stores = fresh();
  await stores.templates.save({ id: 'a', name: 'One', summary: '', descriptionHtml: '', service: null });
  await stores.templates.remove('a');
  assert.deepEqual(await stores.templates.list(), []);
});

test('templates.save stores a copy, not the caller\'s live object', async () => {
  const stores = fresh();
  const original = { id: 'a', name: 'One', summary: 's', descriptionHtml: '<p>x</p>', service: null };
  await stores.templates.save(original);
  original.name = 'mutated after save';
  const [saved] = await stores.templates.list();
  assert.equal(saved?.name, 'One', 'the stored record must not alias the caller\'s object');
});

test('mutating a value returned by list() must not affect what is stored', async () => {
  // createMemoryArea must model chrome.storage.local's snapshot contract:
  // get() structured-clones on every read, so a caller can never mutate
  // storage through a value it was handed back.
  const stores = fresh();
  await stores.templates.save({ id: 'a', name: 'One', summary: 's', descriptionHtml: '<p>x</p>', service: null });
  const [got] = await stores.templates.list();
  if (got) got.name = 'mutated after read';
  const [again] = await stores.templates.list();
  assert.equal(again?.name, 'One', 'a value returned by list() must be a clone, not a live reference');
});

test('mutating the record returned by save() must not affect what is stored', async () => {
  // The other direction of the same contract: chrome.storage.local.set()
  // also takes ownership by cloning, so the caller's own reference to what
  // it just wrote can't reach back into storage either.
  const stores = fresh();
  const saved = await stores.templates.save({ id: 'a', name: 'One', summary: 's', descriptionHtml: '<p>x</p>', service: null });
  saved.name = 'mutated after save';
  const [again] = await stores.templates.list();
  assert.equal(again?.name, 'One', 'the value passed to set() must be cloned, not stored by reference');
});

test('learned mappings are keyed by form signature and clearable in bulk', async () => {
  const stores = fresh();
  await stores.learned.set('abc123', { attribute37: 'briefSummary' });
  await stores.learned.set('def456', { attribute99: 'location' });
  assert.deepEqual(await stores.learned.get('abc123'), { attribute37: 'briefSummary' });
  assert.deepEqual(await stores.learned.get('nope'), {});
  await stores.learned.clearAll();
  assert.deepEqual(await stores.learned.get('abc123'), {});
});

test('learned.clearAll only clears the learned namespace', async () => {
  const stores = fresh();
  await stores.templates.save({ id: 't', name: 'T', summary: '', descriptionHtml: '', service: null });
  await stores.settings.patch({ collapsed: true });
  await stores.learned.set('sig', { a: 'b' });
  await stores.learned.clearAll();
  assert.equal((await stores.templates.list()).length, 1);
  assert.equal((await stores.settings.get()).collapsed, true);
});

test('no store persists requestor data', async () => {
  // Requestor fields include student records and live in panel memory only.
  const stores = fresh();
  assert.deepEqual(Object.keys(stores).sort(), ['learned', 'settings', 'templates']);
});
