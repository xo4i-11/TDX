// Tests that the settings view reads every store on render and that every button actually performs the store write it claims to, not just a DOM change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStores, createMemoryArea, type StorageArea } from '../src/data/stores.ts';
import { renderSettings } from '../src/ui/settings.ts';
import type { Stores } from '../src/types.ts';

/**
 * The honest test wrapper: rethrow. `guarded` is required precisely because a
 * passthrough that drops the returned promise turns a rejected store write
 * into a silent no-op — so in tests a rejection must escape and fail the run,
 * never be swallowed.
 */
const rethrowing = (action: () => void | Promise<void>) => (): void => {
  void Promise.resolve().then(action).catch((error: unknown) => { throw error; });
};

const setup = async (seed?: (stores: Stores) => Promise<void>, given?: Stores) => {
  const win = new JSDOM('<body></body>').window;
  const doc = win.document;
  const stores = given ?? createStores(createMemoryArea());
  await seed?.(stores);
  const el = await renderSettings({ doc, stores, guarded: rethrowing });
  return { doc, stores, el, win };
};

function click(doc: Document, el: Element): void {
  const view = doc.defaultView;
  assert.ok(view);
  el.dispatchEvent(new view.Event('click', { bubbles: true }));
}

function change(doc: Document, el: Element): void {
  const view = doc.defaultView;
  assert.ok(view);
  el.dispatchEvent(new view.Event('change', { bubbles: true }));
}

test('lists stored templates and can remove one', async () => {
  const { el, stores, doc } = await setup(async (s) => {
    await s.templates.save({ id: 'x', name: 'Custom thing', summary: '', descriptionHtml: '', service: null });
  });
  assert.match(el.textContent ?? '', /Custom thing/);

  const button = el.querySelector('button[data-remove-template="x"]');
  assert.ok(button);
  click(doc, button);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await stores.templates.list(), []);
});

test('adding a template stores it, with no invented service', async () => {
  const { el, stores, doc } = await setup();
  const win = doc.defaultView;
  assert.ok(win);
  const name = el.querySelector('input[name="templateName"]');
  const summary = el.querySelector('input[name="templateSummary"]');
  const description = el.querySelector('textarea[name="templateDescription"]');
  assert.ok(name instanceof win.HTMLInputElement);
  assert.ok(summary instanceof win.HTMLInputElement);
  assert.ok(description instanceof win.HTMLTextAreaElement);
  name.value = 'Printer setup';
  summary.value = 'Printer setup — {{ubitName}}';
  description.value = '<p>Installed the driver.</p>';

  const add = el.querySelector('button[data-add-template]');
  assert.ok(add);
  click(doc, add);
  await new Promise((r) => setImmediate(r));

  const [saved] = await stores.templates.list();
  assert.ok(saved);
  assert.equal(saved.name, 'Printer setup');
  assert.equal(saved.summary, 'Printer setup — {{ubitName}}');
  assert.equal(saved.descriptionHtml, '<p>Installed the driver.</p>');
  assert.equal(saved.service, null, 'a new template must not invent a service id');
});

test('clearing learned mappings empties the store', async () => {
  const { el, stores, doc } = await setup(async (s) => s.learned.set('sig', { a: 'briefSummary' }));
  assert.deepEqual(await stores.learned.get('sig'), { a: 'briefSummary' });

  const clear = el.querySelector('button[data-clear-learned]');
  assert.ok(clear);
  click(doc, clear);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await stores.learned.get('sig'), {});
});

test('a store write from one rendered view is visible to a fresh view over the same area', async () => {
  const area = createMemoryArea();
  const storesA = createStores(area);
  const { doc: docA, el: elA, win: winA } = await setup(undefined, storesA);
  assert.ok(winA);
  const nameInput = elA.querySelector('input[name="templateName"]');
  assert.ok(nameInput instanceof winA.HTMLInputElement);
  nameInput.value = 'Shared write';
  const add = elA.querySelector('button[data-add-template]');
  assert.ok(add);
  click(docA, add);
  await new Promise((r) => setImmediate(r));

  const storesB = createStores(area);
  assert.ok((await storesB.templates.list()).some((t) => t.name === 'Shared write'));
});
