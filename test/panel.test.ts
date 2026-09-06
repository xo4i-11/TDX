// Tests that the panel actually wires parsing, template/service selection, filling, results, diagnostics, and settings together — not just that its shell exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { createPanel } from '../src/ui/panel.ts';
import { createStores, createMemoryArea } from '../src/data/stores.ts';
import type { Bridge, Stores } from '../src/types.ts';

const BLOCK = `Requestor
[Anh Duy Nghiem](https://ubuffalo.teamdynamix.com/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310)
[duynghie@buffalo.edu](mailto:duynghie@buffalo.edu)
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

const bridge: Bridge = { async setEditorData() { return { ok: false, detail: 'no CKEDITOR in jsdom' }; } };
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

interface Opened {
  doc: Document;
  stores: Stores;
  $: <T extends Element = Element>(sel: string) => T | null;
}

const open = async (doc: Document = loadFixture()): Promise<Opened> => {
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  return { doc, stores, $: <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel) };
};

function must<T extends Element>(el: T | null, message: string): T {
  assert.ok(el, message);
  return el;
}

function click(el: Element, doc: Document): void {
  const view = doc.defaultView;
  assert.ok(view);
  el.dispatchEvent(new view.Event('click', { bubbles: true }));
}

function change(el: Element, doc: Document): void {
  const view = doc.defaultView;
  assert.ok(view);
  el.dispatchEvent(new view.Event('change', { bubbles: true }));
}

test('mounts into a shadow root so TDX stylesheets cannot reach it', async () => {
  const doc = loadFixture();
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  assert.ok(panel.shadow, 'no shadow root');
  assert.ok(panel.shadow.querySelector('style'), 'stylesheet not attached to the shadow root');
  assert.ok(panel.shadow.querySelector('.panel'));
});

test('destroy removes the panel from the document, so a re-check of the frame sees no leftover host', async () => {
  const doc = loadFixture();
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  assert.ok(doc.getElementById('tdx-autofill-host'), 'panel must be attached before destroy');
  panel.destroy();
  assert.equal(doc.getElementById('tdx-autofill-host'), null, 'destroy must remove the host element');
});

test('contains the controls in the specified order', async () => {
  const { $ } = await open();
  const panelEl = must($<HTMLElement>('.panel'), 'panel missing');
  const order = [...panelEl.querySelectorAll<HTMLElement>('[data-section]')]
    .map((el) => el.dataset.section);
  assert.deepEqual(order, ['requestor', 'template', 'service', 'fill', 'results']);
});

test('parsing a pasted block shows the fields and flags nothing missing', async () => {
  const { $, doc } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement, 'paste textarea missing');
  paste.value = BLOCK;
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();
  const parsed = must($('.parsed'), 'parsed list must render after a parse').textContent ?? '';
  assert.match(parsed, /Anh Duy Nghiem/);
  assert.match(parsed, /duynghie/);
  assert.match(parsed, /b067308b-2198-ef11-9c36-f06ebc4e4310/);
  assert.equal($('.missing'), null, 'nothing should be flagged missing for a complete block');
});

test('a partial paste flags what is missing rather than silently continuing', async () => {
  const { $, doc } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement, 'paste textarea missing');
  paste.value = 'Anh Duy Nghiem\nduynghie@buffalo.edu';
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();
  assert.ok($('.missing'), 'missing fields must be flagged');
});

test('reading from the page recovers the GUID and name TDX prefilled', async () => {
  const { $, doc } = await open();
  click(must($('button[data-read-page]'), 'read-from-page button missing'), doc);
  await settle();
  const parsed = must($('.parsed'), 'parsed list must render after reading the page').textContent ?? '';
  assert.match(parsed, /b067308b-2198-ef11-9c36-f06ebc4e4310/);
});

test('the identifiers are monospace and the prose is not', async () => {
  const { $, doc } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement, 'paste textarea missing');
  paste.value = BLOCK;
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();
  const parsedList = must($('.parsed'), 'parsed list missing');
  const guid = [...parsedList.querySelectorAll('dd')].find((d) => (d.textContent ?? '').includes('b067308b'));
  assert.ok(guid, 'GUID row must be present');
  assert.ok(guid.classList.contains('ident'), 'the GUID must be monospace');
});

test('filling writes the five fields and renders one result row per outcome', async () => {
  const { $, doc } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement, 'paste textarea missing');
  paste.value = BLOCK;
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();

  const template = $('select[name="template"]');
  assert.ok(template instanceof view.HTMLSelectElement, 'template select missing');
  template.value = 'eduroam';
  change(template, doc);
  await settle();

  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();

  const ubit = doc.getElementById('attribute2445');
  assert.ok(ubit instanceof view.HTMLInputElement, 'UBITName field missing on the fixture');
  assert.equal(ubit.value, 'duynghie');
  const results = must($('.results'), 'results list must render after a fill');
  assert.match(results.textContent ?? '', /Brief Summary/);
  assert.match(results.textContent ?? '', /Source/);
});

test('the panel never submits the form', async () => {
  const { $, doc } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const form = doc.querySelector('form');
  assert.ok(form);
  form.submit = () => { throw new Error('submit() called'); };
  form.addEventListener('submit', () => { throw new Error('submit dispatched'); });
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement, 'paste textarea missing');
  paste.value = BLOCK;
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();
  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();
});

test('capturing the service stores the {id,text} pair on the selected template', async () => {
  const { $, doc, stores } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const template = $('select[name="template"]');
  assert.ok(template instanceof view.HTMLSelectElement, 'template select missing');
  template.value = 'eduroam';
  change(template, doc);
  await settle();
  click(must($('button[data-capture-service]'), 'capture-service button missing'), doc);
  await settle();
  const saved = (await stores.templates.list()).find((t) => t.id === 'eduroam');
  assert.ok(saved);
  assert.deepEqual(saved.service, { id: '288', text: 'Personal Device Software and Support / Personal Device Consultation' });
});

test('with no examples saved, the service row says template default and suggests nothing', async () => {
  const { $ } = await open();
  const service = must($('[data-section="service"]'), 'service section missing');
  assert.match(service.textContent ?? '', /template default|no service captured/i);
  assert.equal($('button[data-confirm-service]'), null, 'nothing to confirm with an empty corpus');
});

test('toggling diagnostics renders the copy-pasteable dump', async () => {
  const { $, doc } = await open();
  click(must($('button[data-diagnostics]'), 'diagnostics button missing'), doc);
  await settle();
  const pre = must($('pre.diagnostics'), 'diagnostics dump must render');
  assert.match(pre.textContent ?? '', /attribute37/);
  assert.match(pre.textContent ?? '', /runners-up/);
});

test('the panel collapses and remembers it', async () => {
  const { $, doc, stores } = await open();
  click(must($('button[data-collapse]'), 'collapse button missing'), doc);
  await settle();
  const panel = must($<HTMLElement>('.panel'), 'panel missing');
  assert.equal(panel.dataset.collapsed, 'true');
  assert.equal((await stores.settings.get()).collapsed, true);
});
