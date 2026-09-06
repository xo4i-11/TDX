// Tests that mounting refuses anything that is not a TDX ticket form, never mounts twice, and can wait for a form that renders late.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers.ts';
import { isTicketForm, mountIfTicketForm } from '../src/content/mount.ts';
import { createStores, createMemoryArea } from '../src/data/stores.ts';

test('recognises a TDX ticket form', () => {
  assert.equal(isTicketForm(loadFixture()), true);
});

test('rejects the TDNext shell, which has a search box but no ticket form', () => {
  const doc = new JSDOM('<body><input role="search" placeholder="Search applications..."></body>').window.document;
  assert.equal(isTicketForm(doc), false);
});

test('rejects an unrelated form with no TDX field markers', () => {
  const doc = new JSDOM('<body><form><input name="q"><button>Go</button></form></body>').window.document;
  assert.equal(isTicketForm(doc), false);
});

test('mountIfTicketForm does nothing in a frame with no form', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  assert.equal(await mountIfTicketForm(doc, {}), null);
  assert.equal(doc.body.children.length, 0);
});

test('in wait mode it gives up on a non-ticket frame instead of hanging', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  assert.equal(await mountIfTicketForm(doc, { wait: true, timeout: 80 }), null);
});

test('in wait mode it mounts once the form appears', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>');
  const doc = dom.window.document;
  const stores = createStores(createMemoryArea());
  const pending = mountIfTicketForm(doc, {
    wait: true,
    timeout: 2000,
    stores,
    bridge: { async setEditorData() { return { ok: false, detail: 'stub' }; } },
  });
  const root = doc.getElementById('root');
  assert.ok(root);
  root.innerHTML = '<form><div class="form-group" data-fieldtype="title" data-fieldid="37">'
    + '<label for="attribute37">Brief Summary</label><input id="attribute37" name="attribute37" type="text"></div></form>';
  const mounted = await pending;
  assert.ok(mounted, 'should have mounted once the form appeared');
  assert.ok(doc.getElementById('tdx-autofill-host'));
  // Not just a host element: this proves the wait path actually delegated to
  // createPanel rather than returning a bare stub object.
  assert.ok(mounted.shadow.querySelector('.panel'), 'the mounted handle must be a real panel, not a stub');
});

test('does not mount a second panel into a document that already has one', async () => {
  const doc = loadFixture();
  const stores = createStores(createMemoryArea());
  const bridge = { async setEditorData() { return { ok: false, detail: 'stub' }; } };
  const first = await mountIfTicketForm(doc, { stores, bridge });
  assert.ok(first, 'the first mount on a real ticket form must succeed');
  const second = await mountIfTicketForm(doc, { stores, bridge });
  assert.equal(second, null, 'a second mount into the same document must be refused');
  assert.equal(doc.querySelectorAll('#tdx-autofill-host').length, 1);
});
