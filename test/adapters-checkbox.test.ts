// Tests the checkbox adapter: it writes, it verifies, and it refuses to claim success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fillCheckbox, readCheckbox } from '../src/adapters/checkbox.ts';
import { harvest } from '../src/core/harvest.ts';
import type { Control } from '../src/types.ts';

function boxControl(html: string): { control: Control; doc: Document } {
  const doc = new JSDOM(`<form><div class="form-group">${html}</div></form>`).window.document;
  const control = harvest(doc).find((c) => c.shape === 'checkbox');
  assert.ok(control, 'no checkbox control harvested');
  return { control, doc };
}

test('fillCheckbox unchecks a checked box and reports filled', () => {
  const { control } = boxControl('<input type="checkbox" id="CommentsIsPrivate" name="CommentsIsPrivate" checked>');
  const result = fillCheckbox(control, false);
  assert.equal(result.status, 'filled');
  assert.equal((control.el as HTMLInputElement).checked, false);
});

test('fillCheckbox fires a change event so the page sees the write', () => {
  const { control } = boxControl('<input type="checkbox" id="box" name="box" checked>');
  let seen = 0;
  control.el.addEventListener('change', () => { seen += 1; });
  fillCheckbox(control, false);
  assert.equal(seen, 1);
});

// Falsifiability: a checkbox whose state is forced back (a page script, a
// disabled input) must report failed, not filled — the whole point of the
// read-back contract.
test('fillCheckbox reports failed when the box refuses the change', () => {
  const { control } = boxControl('<input type="checkbox" id="box" name="box" checked>');
  control.el.addEventListener('change', () => { (control.el as HTMLInputElement).checked = true; });
  const result = fillCheckbox(control, false);
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /read back/);
});

test('readCheckbox reports the current state', () => {
  const { control } = boxControl('<input type="checkbox" id="box" name="box" checked>');
  assert.equal(readCheckbox(control), true);
});
