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

const open = async (doc: Document = loadFixture(), given?: Stores): Promise<Opened> => {
  const stores = given ?? createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  return { doc, stores, $: <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel) };
};

// The Requestor card TDX renders beside the form, as markup, not as a paste.
const CARD = `<div class="card"><h3>Requestor</h3>
  <a href="/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310">Anh Duy Nghiem</a>
  <a href="mailto:duynghie@buffalo.edu">duynghie@buffalo.edu</a>
  <div>Student Assistant - ITCX Tech Squad</div>
  <div>University at Buffalo</div>
  <div>50583450 - duynghie</div></div>`;

/** The create form with the requestor card TDX renders beside it — what the panel reads at mount. */
function fixtureWithRequestor(): Document {
  const doc = loadFixture();
  const card = doc.createElement('div');
  card.innerHTML = CARD;
  doc.body.append(card);
  return doc;
}

function must<T extends Element>(el: T | null, message: string): T {
  assert.ok(el, message);
  return el;
}

/** Picking a template is the whole interaction: it fills the form. */
function pickTemplate(doc: Document, select: Element | null, id: string): void {
  const view = doc.defaultView;
  assert.ok(view);
  assert.ok(select instanceof view.HTMLSelectElement, 'template select missing');
  select.value = id;
  select.dispatchEvent(new view.Event('change', { bubbles: true }));
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
  const doc = fixtureWithRequestor();
  const view = doc.defaultView;
  assert.ok(view);
  const stores = createStores(createMemoryArea());
  const panel = await createPanel({ doc, stores, bridge });
  const $ = <T extends Element = Element>(sel: string) => panel.shadow.querySelector<T>(sel);

  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
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
  assert.deepEqual(order, ['requestor', 'template']);
});





test('picking a template fills the form, with no Fill click', async () => {
  const { $, doc } = await open(fixtureWithRequestor());
  const view = doc.defaultView;
  assert.ok(view);

  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
  await settle();

  const ubit = doc.getElementById('attribute2445');
  assert.ok(ubit instanceof view.HTMLInputElement, 'UBITName field missing on the fixture');
  assert.equal(ubit.value, 'duynghie');
  assert.match((doc.getElementById('attribute37') as HTMLInputElement).value, /eduroam/i);
});

test('picking a different template replaces the previous template values', async () => {
  const { $, doc } = await open(fixtureWithRequestor());
  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
  await settle();
  const summary = doc.getElementById('attribute37') as HTMLInputElement;
  const first = summary.value;

  pickTemplate(doc, $('select[name="template"]'), 'duo');
  await settle();
  assert.notEqual(summary.value, first, 'switching templates must rewrite the summary');
});

test('the panel never submits the form', async () => {
  const { $, doc } = await open(fixtureWithRequestor());
  const view = doc.defaultView;
  assert.ok(view);
  const form = doc.querySelector('form');
  assert.ok(form);
  form.submit = () => { throw new Error('submit() called'); };
  form.addEventListener('submit', () => { throw new Error('submit dispatched'); });
  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
  await settle();
});

test('the first fill of a template captures the form service onto it', async () => {
  const { $, doc, stores } = await open();
  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
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

test('the panel collapses and remembers it', async () => {
  const { $, doc, stores } = await open();
  click(must($('button[data-collapse]'), 'collapse button missing'), doc);
  await settle();
  const panel = must($<HTMLElement>('.panel'), 'panel missing');
  assert.equal(panel.dataset.collapsed, 'true');
  assert.equal((await stores.settings.get()).collapsed, true);
});

test('the panel is dragged by its header and remembers where it was dropped', async () => {
  const { $, doc, stores } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const head = must($<HTMLElement>('.head'), 'header missing');
  const drag = (type: string, x: number, y: number): void => {
    head.dispatchEvent(new view.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  };

  drag('pointerdown', 20, 20);
  drag('pointermove', 120, 90);
  drag('pointerup', 120, 90);
  await settle();

  const panelEl = must($<HTMLElement>('.panel'), 'panel missing');
  assert.equal(panelEl.style.left, '100px');
  assert.equal(panelEl.style.top, '70px');
  assert.equal(panelEl.style.right, 'auto', 'the CSS default corner must be released once dragged');
  const saved = await stores.settings.get();
  assert.deepEqual([saved.panelX, saved.panelY], [100, 70]);
});

test('a header button is a button, not a drag handle', async () => {
  const { $, doc, stores } = await open();
  const view = doc.defaultView;
  assert.ok(view);
  const collapse = must($('button[data-collapse]'), 'collapse button missing');
  collapse.dispatchEvent(new view.MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 300 }));
  must($<HTMLElement>('.head'), 'header missing').dispatchEvent(new view.MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 400 }));
  await settle();

  assert.equal(must($<HTMLElement>('.panel'), 'panel missing').style.left, '', 'clicking a header button must not move the panel');
  assert.equal((await stores.settings.get()).panelX, undefined);
});

test('zooming persists and is clamped, so the panel cannot be shrunk out of use', async () => {
  const { $, doc, stores } = await open();
  click(must($('button[data-zoom-in]'), 'zoom-in button missing'), doc);
  await settle();
  assert.equal((await stores.settings.get()).zoom, 1.1);

  for (let i = 0; i < 12; i++) {
    click(must($('button[data-zoom-out]'), 'zoom-out button missing'), doc);
    await settle();
  }
  assert.equal((await stores.settings.get()).zoom, 0.7, 'zoom must stop at the minimum, not keep going');
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
  const doc = fixtureWithRequestor();
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

test('when the whole storage layer is dead (extension reloaded mid-session), picking a template still surfaces a visible error', async () => {
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
  stores.learned.get = dead;
  stores.learned.set = dead;
  stores.learned.clearAll = dead;

  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
  await settle();

  const errorEl = must($<HTMLElement>('[data-error]'), 'persistent error element missing');
  assert.equal(errorEl.hidden, false, 'the error line must be visible even though the recovery render cannot complete');
  assert.match(errorEl.textContent ?? '', /Extension context invalidated/);
});

test('opening Settings renders the real settings view, not an empty panel', async () => {
  const { $, doc } = await open(fixtureWithRequestor());
  click(must($('button[data-settings]'), 'settings button missing'), doc);
  await settle();
  assert.ok($('input[name="templateName"]'), 'the template name field must render');
  assert.ok($('button[data-clear-learned]'), 'clear-learned button must render');
});

test('a fill after the form was re-rendered writes into the live control, not the detached one it was holding', async () => {
  const { $, doc } = await open(fixtureWithRequestor());
  const view = doc.defaultView;
  assert.ok(view);

  // Exactly what a partial postback does: same markup, brand new element.
  const before = doc.getElementById('attribute2445');
  assert.ok(before instanceof view.HTMLInputElement, 'UBITName field missing on the fixture');
  before.replaceWith(before.cloneNode(true));
  assert.equal(before.isConnected, false, 'baseline: the mount-time element is detached');

  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
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


test('the UBITName is read off the requestor card at mount, with no paste and no click', async () => {
  const doc = fixtureWithRequestor();

  const { $ } = await open(doc);
  const parsed = must($('.parsed'), 'parsed list must render from the detected requestor').textContent ?? '';
  assert.match(parsed, /duynghie/, 'UBITName not detected');
  assert.match(parsed, /50583450/, 'person number not detected');
  assert.match(parsed, /b067308b-2198-ef11-9c36-f06ebc4e4310/, 'GUID not detected');
});

test('a requestor card that appears after mount is still picked up', async () => {
  const doc = loadFixture();

  const { $ } = await open(doc);
  assert.doesNotMatch(must($('.parsed'), 'parsed list missing').textContent ?? '', /duynghie/, 'no card yet');

  const card = doc.createElement('div');
  card.innerHTML = CARD;
  doc.body.append(card);
  // waitFor polls every 120ms; the observer is bound to this frame only.
  await new Promise((r) => setTimeout(r, 300));
  await settle();

  assert.match(must($('.parsed'), 'parsed list missing').textContent ?? '', /duynghie/, 'late card never read');
});

test('a detected UBITName is filled instead of the "Unknown" placeholder', async () => {
  const doc = fixtureWithRequestor();

  const { $ } = await open(doc);
  pickTemplate(doc, $('select[name="template"]'), 'eduroam');
  await settle();
  const ubit = doc.querySelector<HTMLInputElement>('#attribute2445');
  assert.ok(ubit, 'UBITName input missing from the fixture');
  assert.equal(ubit.value, 'duynghie');
});

const RESOLVED_CAPTURE = '<p>Your ticket has been resolved.</p><p><span style="color:red">what we tried</span></p>';

test('the panel renders resolve sections on the update form', async () => {
  const { $ } = await open(loadUpdateFixture());
  assert.ok($('[data-section="steps"]'), 'steps section missing');
  assert.ok($('[data-section="resolved"]'), 'resolved-template status missing');
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



test('choosing a template pre-fills the steps box', async () => {
  const doc = loadUpdateFixture();
  const { $ } = await open(doc);
  const template = must($<HTMLSelectElement>('select[name="template"]'), 'template select missing');
  template.value = 'eduroam';
  change(template, doc);
  await settle();
  const steps = must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  assert.match(steps.value, /Downloaded the eduroam certificate/);
});


// Falsifiability: without the guard, selecting a template — Blank especially,
// which has no canned steps — overwrites the box and destroys typed work.
test('choosing a template never wipes steps the technician typed', async () => {
  const doc = loadUpdateFixture();
  const { $ } = await open(doc);
  const steps = must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  steps.value = 'Something I typed';
  steps.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));

  const template = must($<HTMLSelectElement>('select[name="template"]'), 'template select missing');
  template.value = 'eduroam';
  change(template, doc);
  await settle();

  assert.equal(must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing').value, 'Something I typed');
});

const TDX_TEMPLATE_BODY = '<p>Your ticket has been resolved.</p><p><span style="color:#c00">steps taken</span></p><p>Thank you.</p>';

/** Stands in for TDX: clicking a template link fetches a body into the editor. */
function wireTemplateMenu(doc: Document, body = TDX_TEMPLATE_BODY): void {
  for (const link of doc.querySelectorAll('a.js-template')) {
    link.addEventListener('click', () => {
      if ((link.textContent ?? '').trim() === 'Ticket Resolved') loadEditor(doc, body);
    });
  }
}

// Create and resolve share one template list: the eduroam ticket is resolved
// with the eduroam template, so the resolve page must open on it rather than on
// Blank, with the comment already written.
test('the resolve page opens on the template the create form was left on', async () => {
  const area = createMemoryArea();
  const create = fixtureWithRequestor();
  const { $ } = await open(create, createStores(area));
  pickTemplate(create, $('select[name="template"]'), 'eduroam');
  await settle();

  const update = loadUpdateFixture();
  loadEditor(update, '');
  wireTemplateMenu(update);
  const resolve = await open(update, createStores(area));
  await settle();

  const select = must(resolve.$<HTMLSelectElement>('select[name="template"]'), 'template select missing');
  assert.equal(select.value, 'eduroam', 'the resolve page must open on the last template picked');
  const steps = must(resolve.$<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  assert.match(steps.value, /Downloaded the eduroam certificate/);
  const editor = update.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body;
  assert.match(editor?.innerHTML ?? '', /Downloaded the eduroam certificate/, 'the comment must already carry the steps');
});

test('on load the panel opens Templates > ALL > Ticket Resolved by itself', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, '');
  wireTemplateMenu(doc);

  await open(doc);
  await settle();

  const editor = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body;
  assert.match(editor?.innerHTML ?? '', /Your ticket has been resolved/);
});

// The whole point: no menu, no Fill click. Type steps, blur, done.
test('typing steps fills the comment with no Fill click', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, '');
  wireTemplateMenu(doc);

  const { $ } = await open(doc);
  await settle();

  const steps = must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  steps.value = 'Restarted the device\nVerified the connection';
  change(steps, doc);
  await settle();

  const editor = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body;
  assert.match(editor?.innerHTML ?? '', /<li>Restarted the device<\/li>/);
  assert.match(editor?.innerHTML ?? '', /Your ticket has been resolved/, 'the TDX wording must survive');
  assert.equal(editor?.innerHTML.includes('steps taken'), false, 'the red placeholder must be gone');
  assert.equal(doc.querySelector<HTMLInputElement>('#CommentsIsPrivate')?.checked, false);
});

// Falsifiability: TDX's own template click overwrites without asking, so an
// unprompted auto-load would destroy a part-written comment.
test('a comment box with content is never loaded over', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, '<p>Half a comment I was writing</p>');
  wireTemplateMenu(doc);

  await open(doc);
  await settle();

  const editor = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body;
  assert.match(editor?.innerHTML ?? '', /Half a comment I was writing/);
});

// Falsifiability: CKEditor seeds an untouched body with a placeholder
// paragraph. A truthiness check reads that as content, and the panel skips its
// own template load on every fresh ticket — the reported bug.
test('a CKEditor placeholder paragraph does not count as an occupied comment box', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, '<p><br></p>');
  wireTemplateMenu(doc);

  await open(doc);
  await settle();

  const editor = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body;
  assert.match(editor?.innerHTML ?? '', /Your ticket has been resolved/);
});

// End to end: the bullets that land in the editor must be red, because they
// replace red placeholder text and a black list reads as canned wording.
test('the substituted steps land in the comment still red', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, '');
  wireTemplateMenu(doc);

  const { $ } = await open(doc);
  await settle();

  const template = must($<HTMLSelectElement>('select[name="template"]'), 'template select missing');
  template.value = 'eduroam-reconfigure';
  change(template, doc);
  await settle();

  const steps = must($<HTMLTextAreaElement>('textarea[name="steps"]'), 'steps box missing');
  assert.match(steps.value, /Removed the saved eduroam network/, 'picking a template must pre-fill its canned steps');
  change(steps, doc);
  await settle();

  const html = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body.innerHTML ?? '';
  assert.match(html, /<li>Removed the saved eduroam network<\/li>/);
  assert.match(html, /color:\s*#c00[^>]*>\s*<ul>/i, 'the list must sit inside the red wrapper it replaced');
});

// Switching jobs mid-resolve has to correct the comment, not append to a
// resolution describing the previous job's work.
test('changing the template refills the comment with the new steps', async () => {
  const doc = loadUpdateFixture();
  loadEditor(doc, '');
  wireTemplateMenu(doc);

  const { $ } = await open(doc);
  await settle();

  const pick = async (id: string): Promise<void> => {
    const select = must($<HTMLSelectElement>('select[name="template"]'), 'template select missing');
    select.value = id;
    change(select, doc);
    await settle();
  };

  await pick('duo');
  const first = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body.innerHTML ?? '';
  assert.match(first, /Installed Duo Mobile/);

  await pick('password-reset');
  const second = doc.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.body.innerHTML ?? '';
  assert.match(second, /Reset the password/);
  assert.equal(second.includes('Installed Duo Mobile'), false, 'the previous job\u2019s steps must be gone');
});
