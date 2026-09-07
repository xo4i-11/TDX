// Tests that the panel actually wires parsing, template/service selection, filling, results, diagnostics, and settings together — not just that its shell exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture, loadUpdateFixture } from './helpers.ts';
import { createPanel } from '../src/ui/panel.ts';
import { createStores, createMemoryArea } from '../src/data/stores.ts';
import { formSignature } from '../src/core/signature.ts';
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

test('destroy removes the host, the keydown listener, and the highlight outlines it left behind', async () => {
  const doc = loadFixture();
  const view = doc.defaultView;
  assert.ok(view);
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  const $ = <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel);

  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement);
  paste.value = BLOCK;
  must($('button[data-parse]'), 'parse button missing').dispatchEvent(new view.Event('click', { bubbles: true }));
  await settle();
  must($('button[data-fill]'), 'fill button missing').dispatchEvent(new view.Event('click', { bubbles: true }));
  await settle();
  assert.ok(doc.querySelectorAll('.tdxa-touched').length > 0, 'fill should have highlighted at least one control');

  assert.ok(doc.getElementById('tdx-autofill-host'), 'panel must be attached before destroy');
  panel.destroy();

  assert.equal(doc.getElementById('tdx-autofill-host'), null, 'destroy must remove the host element');
  assert.equal(doc.querySelectorAll('.tdxa-touched').length, 0, 'destroy must clear the highlight outlines it left on the page');

  // Proves the keydown listener was really removed, not just the host
  // element: if it were still attached, this Escape would still persist
  // collapsed:true.
  assert.equal((await stores.settings.get()).collapsed, undefined, 'baseline: nothing collapsed yet');
  doc.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal((await stores.settings.get()).collapsed, undefined, 'destroy must remove the keydown listener too');
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
  // Scoped to the requestor section: the panel's persistent (but hidden)
  // top-level error node also carries the shared `.missing` class, so a
  // bare `$('.missing')` would find that instead of proving the parse result
  // itself flagged nothing.
  assert.equal($('[data-section="requestor"] .missing'), null, 'nothing should be flagged missing for a complete block');

  // The Parse click re-renders the whole panel body (replaceChildren); the
  // pasted text must survive that, not just the parsed result it produced.
  const pasteAfter = $('textarea[name="paste"]');
  assert.ok(pasteAfter instanceof view.HTMLTextAreaElement, 'paste textarea missing after render');
  assert.equal(pasteAfter.value, BLOCK, 'the pasted block must still be visible after Parse re-renders the panel');
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
  // The parser's own warning text is the "see why without a debugger" signal
  // this task exists to surface — a bare "missing" dd doesn't say TDX submits
  // a GUID and this paste didn't carry one. Rendered alongside .parsed, not
  // necessarily inside it, so check the whole requestor section.
  const requestorSection = must($('[data-section="requestor"]'), 'requestor section missing');
  assert.match(requestorSection.textContent ?? '', /No person GUID found/);
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

  // The capture promoted a *shipped* template into storage — Settings must
  // not present that as something the technician authored: "Reset to
  // shipped," not "Remove," and the "no custom templates" note stays true.
  click(must($('button[data-settings]'), 'settings button missing'), doc);
  await settle();
  const settingsBody = must($<HTMLElement>('.body'), 'panel body missing');
  const eduroamButton = settingsBody.querySelector('button[data-remove-template="eduroam"]');
  assert.ok(eduroamButton, 'the captured eduroam template must be listed in Settings');
  assert.equal(eduroamButton.textContent, 'Reset to shipped');
  assert.match(settingsBody.textContent ?? '', /No custom templates yet/);
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

test('pressing Escape collapses the panel and remembers it, same as the button', async () => {
  const { $, doc, stores } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  doc.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  const panel = must($<HTMLElement>('.panel'), 'panel missing');
  assert.equal(panel.dataset.collapsed, 'true');
  assert.equal((await stores.settings.get()).collapsed, true);
});

test('a rejected store write surfaces as visible panel text instead of vanishing silently', async () => {
  const doc = loadFixture();
  const view = doc.defaultView;
  assert.ok(view);
  const stores = createStores(createMemoryArea());
  // The routine real-world failure named in review: every chrome.storage.local
  // call rejects with this message once an unpacked extension is reloaded.
  stores.settings.patch = async () => { throw new Error('Extension context invalidated.'); };
  const panel = await createPanel({ doc, stores, bridge });
  const $ = <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel);

  click(must($('button[data-collapse]'), 'collapse button missing'), doc);
  await settle();

  const errorEl = must($<HTMLElement>('[data-error]'), 'persistent error element missing');
  assert.equal(errorEl.hidden, false, 'the error line must be visible');
  assert.match(errorEl.textContent ?? '', /Extension context invalidated/, 'the rejection must be visible panel text, not just a console error');
});

test('when the whole storage layer is dead (extension reloaded mid-session), Fill still surfaces a visible error', async () => {
  // The realistic trigger named in review: "Extension context invalidated"
  // kills every chrome.storage.local call in the tab from that instant, not
  // just the one method a handler happens to call — so the recovery render()
  // itself (which starts with its own stores.settings.get()) cannot survive
  // either. The panel must already have mounted successfully before storage
  // dies (createPanel's own bootstrap calls stores.learned.get/settings.get
  // too — if those are already dead, createPanel itself never resolves, and
  // mount.ts's console.error is the only signal; see the new README section).
  const doc = loadFixture();
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  const $ = <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel);

  const dead = async (): Promise<never> => { throw new Error('Extension context invalidated.'); };
  stores.settings.get = dead;
  stores.settings.patch = dead;
  stores.templates.list = dead;
  stores.templates.save = dead;
  stores.templates.remove = dead;
  stores.examples.list = dead;
  stores.examples.add = dead;
  stores.examples.remove = dead;
  stores.learned.get = dead;
  stores.learned.set = dead;
  stores.learned.clearAll = dead;

  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();

  const errorEl = must($<HTMLElement>('[data-error]'), 'persistent error element missing');
  assert.equal(errorEl.hidden, false, 'the error line must be visible even though the recovery render cannot complete');
  assert.match(errorEl.textContent ?? '', /Extension context invalidated/);
});

test('capturing a service with nothing selected on the form surfaces a notice instead of doing nothing', async () => {
  // No lookup/service field at all on this document, so captureLookup has
  // nothing to read — the ordinary case where the technician forgot to set
  // the Service field on the form before clicking Capture.
  const doc = new JSDOM('<body><form></form></body>').window.document;
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  const $ = <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel);

  click(must($('button[data-capture-service]'), 'capture-service button missing'), doc);
  await settle();

  const errorEl = must($<HTMLElement>('[data-error]'), 'persistent error element missing');
  assert.equal(errorEl.hidden, false);
  assert.match(errorEl.textContent ?? '', /could not capture a service/i);
});

test('saving an example with no service confirmed surfaces a notice instead of doing nothing', async () => {
  const { $, doc, stores } = await open();
  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();
  click(must($('button[data-save-example]'), 'save-example button missing'), doc);
  await settle();

  assert.equal((await stores.examples.list()).length, 0, 'nothing should be saved without a service');
  const errorEl = must($<HTMLElement>('[data-error]'), 'persistent error element missing');
  assert.equal(errorEl.hidden, false);
  assert.match(errorEl.textContent ?? '', /could not save an example/i);
});

test('saving an example after a fill stores it under the confirmed service', async () => {
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
  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();
  click(must($('button[data-save-example]'), 'save-example button missing'), doc);
  await settle();

  const examples = await stores.examples.list();
  assert.equal(examples.length, 1);
  const [saved] = examples;
  assert.ok(saved);
  assert.deepEqual(saved.service, { id: '288', text: 'Personal Device Software and Support / Personal Device Consultation' });
});

test('the overwrite checkbox round-trips through settings and survives a re-render', async () => {
  const { $, doc, stores } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const overwrite = $('input[name="overwrite"]');
  assert.ok(overwrite instanceof view.HTMLInputElement, 'overwrite checkbox missing');
  assert.equal(overwrite.checked, false);

  overwrite.checked = true;
  change(overwrite, doc);
  await settle();
  assert.equal((await stores.settings.get()).overwrite, true);

  // A different button triggers a full re-render (replaceChildren) — proves
  // the checked state is read back from settings, not just written once.
  click(must($('button[data-diagnostics]'), 'diagnostics button missing'), doc);
  await settle();
  const overwriteAfter = $('input[name="overwrite"]');
  assert.ok(overwriteAfter instanceof view.HTMLInputElement, 'overwrite checkbox missing after re-render');
  assert.equal(overwriteAfter.checked, true);
});

test('opening Settings renders the real settings view, not an empty panel', async () => {
  const { $, doc } = await open();
  click(must($('button[data-settings]'), 'settings button missing'), doc);
  await settle();
  assert.ok($('input[name="threshold"]'), 'threshold input must render');
  assert.ok($('button[data-clear-learned]'), 'clear-learned button must render');
});

test('correcting a mapping in the results panel is learned and immediately re-resolves', async () => {
  const { $, doc, stores } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement);
  paste.value = BLOCK;
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();
  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();

  const sourceRow = must($('li[data-field="source"]'), 'source result row missing');
  const correction = sourceRow.querySelector('select');
  assert.ok(correction, 'correction dropdown missing on the source row');
  correction.value = 'briefSummary'; // deliberately wrong; only the wiring is under test
  change(correction, doc);
  await settle();

  const signature = formSignature(doc);
  assert.deepEqual(Object.values(await stores.learned.get(signature)), ['briefSummary'], 'the correction must be written to the learned store');

  // Proves resolution was actually rebuilt from the new learned map, not just
  // that the store was written: the diagnostic dump reflects tier 0 now.
  click(must($('button[data-diagnostics]'), 'diagnostics button missing'), doc);
  await settle();
  const dump = must($('pre.diagnostics'), 'diagnostics dump must render').textContent ?? '';
  assert.match(dump, /learned from a previous correction on this form/);
});

// TDX is ASP.NET WebForms: an AutoPostBack select or a cascading Service ->
// Service Offering lookup replaces whole DOM subtrees, and the adapters
// themselves dispatch the change events that trigger those partial postbacks.
// If Fill reused the resolution captured at mount, it would write into the
// detached node it still held, read that same node back, and report "filled"
// for a value that is not on the form — the one silent failure the read-back
// discipline cannot see.
test('a fill after the form was re-rendered writes into the live control, not the detached one it was holding', async () => {
  const { $, doc } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const paste = $('textarea[name="paste"]');
  assert.ok(paste instanceof view.HTMLTextAreaElement);
  paste.value = BLOCK;
  click(must($('button[data-parse]'), 'parse button missing'), doc);
  await settle();

  // Exactly what a partial postback does: same markup, brand new element.
  const before = doc.getElementById('attribute2445');
  assert.ok(before instanceof view.HTMLInputElement, 'UBITName field missing on the fixture');
  before.replaceWith(before.cloneNode(true));
  assert.equal(before.isConnected, false, 'baseline: the mount-time element is detached');

  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();

  const after = doc.getElementById('attribute2445');
  assert.ok(after instanceof view.HTMLInputElement);
  assert.equal(after.value, 'duynghie', 'the control actually on the page must carry the value');
  assert.equal(before.value, '', 'the detached element must not have been written instead');
});

// If the host is appended before the store reads that can reject, a failed
// mount leaves an empty #tdx-autofill-host on the page with no handle to
// destroy() it — and mount.ts's already-mounted guard then matches that corpse,
// so every later retry declines.
test('a mount that fails partway leaves no orphan host element on the page', async () => {
  const doc = loadFixture();
  const stores = createStores(createMemoryArea());
  stores.settings.get = async () => { throw new Error('Extension context invalidated.'); };

  await assert.rejects(createPanel({ doc, stores, bridge }), /Extension context invalidated/);
  assert.equal(doc.getElementById('tdx-autofill-host'), null, 'a failed mount must not leave a host behind');
});

// The Requestor card TDX renders beside the form, as markup, not as a paste.
const CARD = `<div class="card"><h3>Requestor</h3>
  <a href="/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310">Anh Duy Nghiem</a>
  <a href="mailto:duynghie@buffalo.edu">duynghie@buffalo.edu</a>
  <div>Student Assistant - ITCX Tech Squad</div>
  <div>University at Buffalo</div>
  <div>50583450 - duynghie</div></div>`;

test('the UBITName is read off the requestor card at mount, with no paste and no click', async () => {
  const doc = loadFixture();
  const card = doc.createElement('div');
  card.innerHTML = CARD;
  doc.body.append(card);

  const { $ } = await open(doc);
  const parsed = must($('.parsed'), 'parsed list must render from the detected requestor').textContent ?? '';
  assert.match(parsed, /duynghie/, 'UBITName not detected');
  assert.match(parsed, /50583450/, 'person number not detected');
  assert.match(parsed, /b067308b-2198-ef11-9c36-f06ebc4e4310/, 'GUID not detected');
});

test('a detected UBITName is filled instead of the "Unknown" placeholder', async () => {
  const doc = loadFixture();
  const card = doc.createElement('div');
  card.innerHTML = CARD;
  doc.body.append(card);

  const { $ } = await open(doc);
  click(must($('button[data-fill]'), 'fill button missing'), doc);
  await settle();
  const ubit = doc.querySelector<HTMLInputElement>('#attribute2445');
  assert.ok(ubit, 'UBITName input missing from the fixture');
  assert.equal(ubit.value, 'duynghie');
});

const RESOLVED_CAPTURE = '<p>Your ticket has been resolved.</p><p><span style="color:red">what we tried</span></p>';

test('the panel renders resolve sections on the update form', async () => {
  const { $ } = await open(loadUpdateFixture());
  assert.ok($('[data-section="steps"]'), 'steps section missing');
  assert.ok($('button[data-capture-resolved]'), 'capture button missing');
  assert.equal($('[data-section="service"]'), null, 'the service section belongs to the create form only');
});

/** Puts markup where CKEditor puts it: the editor iframe's body, which is what the real page shows. */
function loadEditor(doc: Document, html: string): void {
  const iframe = doc.querySelector<HTMLIFrameElement>('iframe');
  const body = iframe?.contentDocument?.body;
  if (body) {
    body.innerHTML = html;
    return;
  }
  const textarea = doc.querySelector<HTMLTextAreaElement>('#Comments_Content');
  assert.ok(textarea, 'no editor to load in this fixture');
  textarea.value = html;
}

test('capture rewrites the red block to a {{steps}} template and stores it', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, RESOLVED_CAPTURE);

  const { $, stores } = await open(doc);
  click(must($('button[data-capture-resolved]'), 'capture button missing'), doc);
  await settle();
  click(must($('button[data-confirm-capture]'), 'confirm button missing'), doc);
  await settle();

  const saved = (await stores.settings.get()).resolvedCommentHtml ?? '';
  assert.match(saved, /\{\{steps\}\}/);
  assert.equal(saved.includes('what we tried'), false);
});

// Falsifiability: without the guard an empty editor stores an empty template,
// and every later fill writes a blank client-visible comment.
test('capture refuses an empty editor instead of storing nothing', async () => {
  const doc = loadUpdateFixture();
  const { $, stores } = await open(doc);
  click(must($('button[data-capture-resolved]'), 'capture button missing'), doc);
  await settle();
  assert.equal((await stores.settings.get()).resolvedCommentHtml ?? null, null);
  assert.match(must($('[data-error]'), 'error line missing').textContent ?? '', /empty/i);
});

test('choosing a template pre-fills the steps box', async () => {
  const doc = loadUpdateFixture();
  const { $ } = await open(doc);
  const template = must($<HTMLSelectElement>('select[name="template"]'), 'template select missing');
  template.value = 'eduroam';
  change(template, doc);
  await settle();
  const steps = must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  assert.match(steps.value, /CAT configuration tool/);
});
