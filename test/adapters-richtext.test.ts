// Tests the rich-text adapter's three fallback paths (CKEditor bridge, iframe body, plain textarea) and the isolated-world bridge client's message-matching and timeout behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { fillRichText, readRichText, readRichTextHtml, createBridgeClient } from '../src/adapters/richtext.ts';
import type { Bridge, Control } from '../src/types.ts';

const HTML = '<p>Removed the stale eduroam profile.</p>';

const richControl = (markup: string): Control => {
  const doc = new JSDOM(`<form>${markup}</form>`).window.document;
  const control = harvest(doc).find((c) => c.shape === 'richtext');
  assert.ok(control, 'expected harvest to produce a richtext control');
  return control;
};

const TEXTAREA_ONLY = `
<div class="form-group" data-fieldtype="description" data-fieldid="138">
  <label for="attribute138_Content">Description</label>
  <textarea id="attribute138_Content" name="attribute138.Content" style="display:none"></textarea>
</div>`;

const WITH_IFRAME = `
<div class="form-group" data-fieldtype="description" data-fieldid="138">
  <label for="attribute138_Content">Description</label>
  <textarea id="attribute138_Content" name="attribute138.Content" style="display:none"></textarea>
  <div class="cke"><iframe title="Rich Text Editor"></iframe></div>
</div>`;

interface FakeBridge extends Bridge {
  calls: { key: string; html: string }[];
}

const okBridge = (): FakeBridge => ({
  calls: [],
  async setEditorData(key: string, html: string) {
    this.calls.push({ key, html });
    return { ok: true, detail: 'CKEditor instance' };
  },
});

const absentBridge = (): Bridge => ({
  async setEditorData() {
    return { ok: false, detail: 'no CKEDITOR instance for that key' };
  },
});

test('uses the CKEditor bridge when the instance exists', async () => {
  const control = richControl(TEXTAREA_ONLY);
  const bridge = okBridge();
  const result = await fillRichText(control, HTML, { bridge });
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /CKEditor/);
  assert.deepEqual(bridge.calls, [{ key: 'attribute138_Content', html: HTML }]);
});

test('the bridge is asked for the harvested instance key, not a hardcoded one', async () => {
  const markup = TEXTAREA_ONLY.replace(/attribute138_Content/g, 'attribute999_Content');
  const bridge = okBridge();
  await fillRichText(richControl(markup), HTML, { bridge });
  assert.equal(bridge.calls[0]?.key, 'attribute999_Content');
});

test('falls back to the same-origin iframe body when CKEditor is absent', async () => {
  const control = richControl(WITH_IFRAME);
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /iframe/i);
  assert.ok(control.richtext);
  const iframe = control.richtext.textarea.closest('.form-group')?.querySelector('iframe') as HTMLIFrameElement;
  assert.match(iframe.contentDocument?.body.innerHTML ?? '', /stale eduroam profile/);
  assert.equal(control.richtext.textarea.value, HTML, 'the backing textarea must carry the value that posts back');
});

test('falls back to the bare textarea when there is no editor at all', async () => {
  const control = richControl(TEXTAREA_ONLY);
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /textarea/i);
  assert.ok(control.richtext);
  assert.equal(control.richtext.textarea.value, HTML);
});

test('reports failed rather than claiming success when no path verifies', async () => {
  const control = richControl(TEXTAREA_ONLY);
  assert.ok(control.richtext);
  // A textarea that refuses writes: the adapter must not report filled.
  Object.defineProperty(control.richtext.textarea, 'value', {
    configurable: true, get: () => '', set: () => {},
  });
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /verif/i);
});

test('a bridge that never answers does not hang the fill', async () => {
  const control = richControl(TEXTAREA_ONLY);
  const stalled: Bridge = { setEditorData: () => new Promise(() => {}) };
  const result = await fillRichText(control, HTML, { bridge: stalled, bridgeTimeout: 50 });
  // Falls through to the textarea rather than waiting forever.
  assert.equal(result.status, 'filled');
  assert.match(result.detail, /textarea/i);
});

test('readRichText reports current content for preserve checks', async () => {
  const control = richControl(TEXTAREA_ONLY);
  assert.equal(readRichText(control), '');
  await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.match(readRichText(control), /stale eduroam profile/);
});

// harvest.ts's own group boundary is '.form-group, [data-fieldtype],
// [data-fieldid]' — broader than a bare '.form-group' class check, precisely
// because a field's immediate group can be marked only by data-fieldtype/
// data-fieldid. A narrower selector in the adapter climbs past that group to
// a shared ancestor and can land the write in a sibling field's editor.
const SHARED_ANCESTOR_NO_FORM_GROUP_CLASS = `
<div class="form-group">
  <div class="cke"><iframe title="Rich Text Editor" data-owner="wrong-field"></iframe></div>
  <div data-fieldtype="description" data-fieldid="138">
    <label for="attribute138_Content">Description</label>
    <textarea id="attribute138_Content" name="attribute138.Content" style="display:none"></textarea>
    <div class="cke"><iframe title="Rich Text Editor" data-owner="right-field"></iframe></div>
  </div>
</div>`;

test('does not climb past a data-fieldtype-only group into a sibling field\'s editor', async () => {
  const control = richControl(SHARED_ANCESTOR_NO_FORM_GROUP_CLASS);
  const result = await fillRichText(control, HTML, { bridge: absentBridge() });
  assert.equal(result.status, 'filled');

  const doc = control.el.ownerDocument;
  const wrongIframe = doc.querySelector('iframe[data-owner="wrong-field"]') as HTMLIFrameElement;
  const rightIframe = doc.querySelector('iframe[data-owner="right-field"]') as HTMLIFrameElement;

  assert.match(
    rightIframe.contentDocument?.body.innerHTML ?? '',
    /stale eduroam profile/,
    'the write must land in this field\'s own editor',
  );
  assert.doesNotMatch(
    wrongIframe.contentDocument?.body.innerHTML ?? '',
    /stale eduroam profile/,
    'a sibling field\'s editor must not receive this field\'s value',
  );
});

// --- createBridgeClient: the isolated-world half of the trust boundary. ---
// jsdom does not deliver realistic `origin`/`source` on a same-window
// postMessage round trip, so these tests drive the registered listener
// directly with a minimal fake window instead of a real dispatch.

interface FakeWindow {
  location: { origin: string };
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

interface FakeWindowHandle {
  win: FakeWindow;
  listeners: Set<(event: MessageEvent) => void>;
  posted: { message: unknown; targetOrigin: string }[];
}

function fakeWindow(origin: string): FakeWindowHandle {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posted: { message: unknown; targetOrigin: string }[] = [];
  const win: FakeWindow = {
    location: { origin },
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
    postMessage: (message, targetOrigin) => { posted.push({ message, targetOrigin }); },
    setTimeout,
    clearTimeout,
  };
  return { win, listeners, posted };
}

function dispatch(listeners: Set<(event: MessageEvent) => void>, event: { source: unknown; origin: string; data: unknown }): void {
  for (const listener of [...listeners]) listener(event as MessageEvent);
}

test('createBridgeClient posts requests to the page origin, never "*"', async () => {
  const { win, listeners, posted } = fakeWindow('https://ubuffalo.teamdynamix.com');
  const client = createBridgeClient(win as unknown as Window);
  const promise = client.setEditorData('attribute138_Content', HTML);
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.targetOrigin, 'https://ubuffalo.teamdynamix.com');
  assert.notEqual(posted[0]?.targetOrigin, '*');
  // Settle the round trip so this test doesn't leave the client's internal
  // timeout timer alive for the rest of the suite.
  const sentId = (posted[0]?.message as { id: number }).id;
  dispatch(listeners, {
    source: win,
    origin: win.location.origin,
    data: { channel: 'tdxa', direction: 'response', id: sentId, ok: true, detail: 'x' },
  });
  await promise;
});

test('createBridgeClient ignores a reply from the wrong origin and one with a stale id, then resolves on the matching reply', async () => {
  const { win, listeners, posted } = fakeWindow('https://ubuffalo.teamdynamix.com');
  const client = createBridgeClient(win as unknown as Window);
  const promise = client.setEditorData('attribute138_Content', HTML);
  const sentId = (posted[0]?.message as { id: number }).id;

  // Wrong origin: a hostile page cannot forge a reply from another origin.
  dispatch(listeners, {
    source: win,
    origin: 'https://evil.example',
    data: { channel: 'tdxa', direction: 'response', id: sentId, ok: true, detail: 'forged' },
  });
  // Right origin, wrong id: some other in-flight request's reply must not match.
  dispatch(listeners, {
    source: win,
    origin: win.location.origin,
    data: { channel: 'tdxa', direction: 'response', id: sentId + 999, ok: true, detail: 'stale' },
  });
  // The real reply.
  dispatch(listeners, {
    source: win,
    origin: win.location.origin,
    data: { channel: 'tdxa', direction: 'response', id: sentId, ok: true, detail: 'CKEditor instance' },
  });

  assert.deepEqual(await promise, { ok: true, detail: 'CKEditor instance' });
});

test('createBridgeClient removes its message listener once a reply lands', async () => {
  const { win, listeners, posted } = fakeWindow('https://ubuffalo.teamdynamix.com');
  const client = createBridgeClient(win as unknown as Window);
  const promise = client.setEditorData('attribute138_Content', HTML);
  assert.equal(listeners.size, 1, 'expected exactly one listener while a request is in flight');
  const sentId = (posted[0]?.message as { id: number }).id;
  dispatch(listeners, {
    source: win,
    origin: win.location.origin,
    data: { channel: 'tdxa', direction: 'response', id: sentId, ok: true, detail: 'x' },
  });
  await promise;
  assert.equal(listeners.size, 0, 'listener must be torn down once the round trip resolves');
});

// Capture needs the markup; fill policy only ever needed "is there anything
// here", which is why readRichText strips it.
test('readRichTextHtml returns markup where readRichText returns text', () => {
  const control = richControl(WITH_IFRAME);
  const iframe = control.richtext?.textarea.closest('.form-group')?.querySelector('iframe') as HTMLIFrameElement;
  const body = iframe.contentDocument?.body;
  assert.ok(body);
  body.innerHTML = '<p>Removed the <b>stale</b> profile.</p>';
  assert.match(readRichTextHtml(control), /<b>stale<\/b>/);
  assert.equal(readRichText(control).includes('<b>'), false);
});
