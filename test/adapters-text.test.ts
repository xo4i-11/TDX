// Tests that the text/select adapter writes through the native setter, verifies every write by reading it back, and reports failed rather than lying about a reverted value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { fillText, fillSelect, readValue, setNativeValue } from '../src/adapters/text.ts';
import type { Control } from '../src/types.ts';

const controlFor = (html: string, id: string): Control | undefined => {
  const doc = new JSDOM(`<form>${html}</form>`).window.document;
  return harvest(doc).find((c) => c.id === id);
};

const TEXT = '<label for="f">Field</label><input id="f" name="f" type="text">';
const SELECT = '<label for="s">Sel</label><select id="s" name="s">'
  + '<option value=""></option><option value="1">Walkup</option><option value="2">Phone</option></select>';

test('setNativeValue writes through the prototype setter, not the instance property', () => {
  const doc = new JSDOM('<input id="f">').window.document;
  const el = doc.getElementById('f') as HTMLInputElement;
  // A widget that shadows `value` with its own accessor is exactly the case
  // this defends against: assigning el.value would hit the shadow, not the DOM.
  let shadowed = '';
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => shadowed,
    set: (v: string) => { shadowed = `intercepted:${v}`; },
  });
  setNativeValue(el, 'hello');
  // @ts-expect-error -- deleting an own property that TS believes is required
  delete el.value;
  assert.equal(el.value, 'hello', 'prototype setter must reach the real value');
});

test('fillText writes, fires the events a widget listens for, and verifies', () => {
  const control = controlFor(TEXT, 'f');
  assert.ok(control);
  const seen: string[] = [];
  for (const type of ['input', 'change', 'blur']) {
    control.el.addEventListener(type, () => seen.push(type));
  }
  const result = fillText(control, 'duynghie');
  assert.equal(result.status, 'filled');
  assert.equal((control.el as HTMLInputElement).value, 'duynghie');
  assert.deepEqual(seen, ['input', 'change', 'blur']);
});

test('fillText reports failed when the control refuses the value', () => {
  const control = controlFor(TEXT, 'f');
  assert.ok(control);
  // Simulates a widget that reverts on change — the exact silent failure the
  // read-back check exists to catch.
  control.el.addEventListener('change', () => setNativeValue(control.el as HTMLInputElement, ''));
  const result = fillText(control, 'duynghie');
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /duynghie/);
  assert.match(result.detail, /read back/i);
});

test('fillSelect matches option text case-insensitively', () => {
  const control = controlFor(SELECT, 's');
  assert.ok(control);
  const result = fillSelect(control, 'walkup');
  assert.equal(result.status, 'filled');
  assert.equal((control.el as HTMLSelectElement).value, '1');
});

test('fillSelect falls back to a startsWith match', () => {
  const control = controlFor(SELECT, 's');
  assert.ok(control);
  const result = fillSelect(control, 'Walk');
  assert.equal(result.status, 'filled');
  assert.equal((control.el as HTMLSelectElement).value, '1');
  assert.match(result.detail, /Walkup/);
});

test('fillSelect fails loudly when no option matches', () => {
  const control = controlFor(SELECT, 's');
  assert.ok(control);
  const result = fillSelect(control, 'Carrier Pigeon');
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /no option/i);
  assert.equal((control.el as HTMLSelectElement).value, '');
});

test('fillSelect dispatches change so the widget model updates', () => {
  const control = controlFor(SELECT, 's');
  assert.ok(control);
  let fired = 0;
  control.el.addEventListener('change', () => { fired += 1; });
  fillSelect(control, 'Walkup');
  assert.equal(fired, 1);
});

test('readValue reports the current text for both shapes', () => {
  const text = controlFor(TEXT, 'f');
  assert.ok(text);
  assert.equal(readValue(text), '');
  fillText(text, 'x');
  assert.equal(readValue(text), 'x');

  const select = controlFor(SELECT, 's');
  assert.ok(select);
  assert.equal(readValue(select), '');
  fillSelect(select, 'Phone');
  assert.equal(readValue(select), 'Phone');
});

// The reachable caller is fill policy's `byKey('source')?.fixedValue ?? ''`.
// With an empty string, startsWith('') matches every option, so the prefix arm
// used to select the *first* option and report filled — writing whatever TDX
// happens to list first into a routing field. Fixed in the adapter so every
// caller fails loudly rather than each one guarding itself.
test('fillSelect refuses an empty value instead of selecting the first option', () => {
  const control = controlFor(SELECT, 's');
  assert.ok(control);
  const el = control.el as HTMLSelectElement;
  el.selectedIndex = -1;

  const result = fillSelect(control, '');
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /no value to select/i);
  assert.equal(el.selectedIndex, -1, 'nothing may be selected as a side effect');
});
