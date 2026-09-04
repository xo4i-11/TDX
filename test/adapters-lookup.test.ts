// Tests that the lookup adapter writes id+text+reset from a captured pair, verifies both halves by reading back, and that capture/read recover a technician's existing selection including TDX's data-default prefill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { fillLookup, captureLookup, readLookup } from '../src/adapters/lookup.ts';
import type { Control } from '../src/types.ts';

const LOOKUP = `
<div class="form-group" data-fieldtype="service" data-fieldid="789">
  <label for="attribute789">Service</label>
  <input id="attribute789_reset" name="Item.ServiceID_reset" type="hidden" value="">
  <input id="attribute789_input" name="attribute789_input" type="text" value="">
  <input id="attribute789" name="attribute789" type="hidden" value=""
         data-selectlookup="true" data-wsurl="/TDNext/Apps/31/Shared/Services/Autocomplete">
</div>`;

const lookupControl = (html = LOOKUP): Control => {
  const doc = new JSDOM(`<form>${html}</form>`).window.document;
  const control = harvest(doc).find((c) => c.shape === 'lookup');
  assert.ok(control, 'expected harvest to produce a lookup control');
  return control;
};

const SERVICE = { id: '288', text: 'Personal Device Software and Support / Personal Device Consultation' };

test('fillLookup writes the id, the display text, and the reset field', () => {
  const control = lookupControl();
  const result = fillLookup(control, SERVICE);
  assert.equal(result.status, 'filled');
  assert.ok(control.lookup);
  assert.equal(control.lookup.hidden.value, '288');
  assert.equal(control.lookup.input.value, SERVICE.text);
  assert.equal(control.lookup.reset?.value, '288');
});

test('fillLookup makes no network request', () => {
  // The whole point of capture over search: no AJAX, no suggestion popup, no
  // ordering constraint between two lookups sharing one container.
  const control = lookupControl();
  assert.ok(control.lookup);
  const view = control.lookup.hidden.ownerDocument.defaultView;
  assert.ok(view);
  view.fetch = (() => { throw new Error('network call attempted'); }) as typeof fetch;
  view.XMLHttpRequest = function XMLHttpRequestStub() {
    throw new Error('network call attempted');
  } as unknown as typeof XMLHttpRequest;
  assert.equal(fillLookup(control, SERVICE).status, 'filled');
});

test('fillLookup dispatches change on both halves so the widget model updates', () => {
  const control = lookupControl();
  assert.ok(control.lookup);
  const seen: string[] = [];
  control.lookup.hidden.addEventListener('change', () => seen.push('hidden'));
  control.lookup.input.addEventListener('change', () => seen.push('input'));
  fillLookup(control, SERVICE);
  assert.ok(seen.includes('hidden'));
  assert.ok(seen.includes('input'));
});

test('fillLookup reports failed when the id does not stick', () => {
  const control = lookupControl();
  assert.ok(control.lookup);
  control.lookup.hidden.addEventListener('change', () => {
    control.lookup?.hidden.setAttribute('value', '');
    if (control.lookup) control.lookup.hidden.value = '';
  });
  const result = fillLookup(control, SERVICE);
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /288/);
});

test('fillLookup reports failed when the display text does not stick', () => {
  const control = lookupControl();
  assert.ok(control.lookup);
  control.lookup.input.addEventListener('change', () => {
    if (control.lookup) control.lookup.input.value = 'something else';
  });
  const result = fillLookup(control, SERVICE);
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /display text/i);
});

test('fillLookup rejects an incomplete capture instead of writing half a value', () => {
  const control = lookupControl();
  assert.ok(control.lookup);
  assert.equal(fillLookup(control, { id: '288' }).status, 'failed');
  assert.equal(fillLookup(control, { text: 'x' }).status, 'failed');
  assert.equal(fillLookup(control, null).status, 'failed');
  assert.equal(control.lookup.hidden.value, '', 'must not partially write');
});

test('captureLookup reads back what a technician set by hand', () => {
  const control = lookupControl();
  assert.ok(control.lookup);
  control.lookup.hidden.value = '288';
  control.lookup.input.value = SERVICE.text;
  assert.deepEqual(captureLookup(control), SERVICE);
});

test('captureLookup returns null for an empty lookup', () => {
  assert.equal(captureLookup(lookupControl()), null);
});

test('captureLookup falls back to the data-default TDX prefills', () => {
  const html = LOOKUP.replace(
    'data-selectlookup="true"',
    'data-selectlookup="true" data-default="[{&quot;caption&quot;:&quot;Capen Hall&quot;,&quot;value&quot;:&quot;139&quot;}]"',
  ).replace('id="attribute789" name="attribute789" type="hidden" value=""', 'id="attribute789" name="attribute789" type="hidden" value="139"');
  const control = lookupControl(html);
  assert.deepEqual(captureLookup(control), { id: '139', text: 'Capen Hall' });
});

test('readLookup reports the visible text for preserve checks', () => {
  const control = lookupControl();
  assert.equal(readLookup(control), '');
  fillLookup(control, SERVICE);
  assert.equal(readLookup(control), SERVICE.text);
});
