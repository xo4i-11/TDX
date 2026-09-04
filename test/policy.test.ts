// Tests the fill policy: what gets written, what gets preserved, and what gets reported instead of guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve } from '../src/core/resolve.ts';
import { runFill, planFill } from '../src/fill/policy.ts';
import { SHIPPED_TEMPLATES } from '../src/data/templates.ts';
import type { Bridge, Captured, FillRow, RequestorFields, Settings } from '../src/types.ts';

const REQUESTOR: RequestorFields = {
  name: 'Anh Duy Nghiem',
  email: 'duynghie@buffalo.edu',
  ubitName: 'duynghie',
  personNumber: '50583450',
  personGuid: null,
  title: null,
  organization: null,
};
const EDUROAM = SHIPPED_TEMPLATES.find((t) => t.id === 'eduroam');
assert.ok(EDUROAM, 'fixture template "eduroam" must exist for these tests');
const SERVICE: Captured = { id: '288', text: 'Personal Device Consultation' };
const bridge: Bridge = { async setEditorData() { return { ok: false, detail: 'no CKEDITOR in jsdom' }; } };

const setup = (doc: Document = loadFixture()) => {
  const controls = harvest(doc);
  return { doc, controls, resolution: resolve(controls) };
};

const row = (rows: FillRow[], key: string): FillRow | undefined => rows.find((r) => r.fieldKey === key);
const settings = (over: Partial<Settings> = {}): Settings => ({ threshold: 0.35, overwrite: false, diagnostics: false, ...over });

const inputEl = (doc: Document, id: string): HTMLInputElement => doc.getElementById(id) as HTMLInputElement;
const selectEl = (doc: Document, id: string): HTMLSelectElement => doc.getElementById(id) as HTMLSelectElement;
const textareaEl = (doc: Document, id: string): HTMLTextAreaElement => doc.getElementById(id) as HTMLTextAreaElement;

test('every fill-set field produces a row with a status; nothing fails silently', async () => {
  const { resolution } = setup();
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  for (const key of ['ubitName', 'briefSummary', 'description', 'source', 'service']) {
    const r = row(rows, key);
    assert.ok(r, `${key} produced no row`);
    assert.ok(['filled', 'preserved', 'skipped', 'failed', 'needs-confirm'].includes(r.status), `${key} status ${r.status}`);
    assert.equal(typeof r.detail, 'string');
  }
});

test('the five fields are written with the right values', async () => {
  const { doc, resolution } = setup();
  // attribute789 (the hidden lookup id) is prefilled by the fixture's
  // data-default blob, so with the default overwrite:false the service row
  // would take the 'preserved' branch and never call fillLookup — proving
  // nothing about the write path. overwrite:true forces the write so the
  // visible input (which starts empty) can only read back SERVICE.text if
  // fillLookup actually ran.
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings({ overwrite: true }) }, { bridge });
  assert.equal(inputEl(doc, 'attribute2445').value, 'duynghie');
  assert.match(inputEl(doc, 'attribute37').value, /eduroam/i);
  const source = selectEl(doc, 'attribute371');
  assert.equal(source.options[source.selectedIndex]?.textContent?.trim(), 'Walkup');
  assert.equal(row(rows, 'service')?.status, 'filled');
  assert.equal(inputEl(doc, 'attribute789').value, SERVICE.id);
  assert.equal(inputEl(doc, 'attribute789_input').value, SERVICE.text);
  assert.match(textareaEl(doc, 'attribute138_Content').value, /eduroam CAT/);
});

test('ACCEPTANCE: affiliation is never written', async () => {
  const { doc, resolution } = setup();
  const before = selectEl(doc, 'attribute2706').value;
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(selectEl(doc, 'attribute2706').value, before);
  const affiliation = row(rows, 'affiliation');
  assert.ok(affiliation);
  assert.equal(affiliation.action, 'report', 'affiliation must never take the write path');
  assert.equal(affiliation.status, 'skipped');
  assert.match(affiliation.detail, /scope/i);
});

test('ACCEPTANCE: the extension never calls submit', async () => {
  const { doc, resolution } = setup();
  const form = doc.querySelector('form');
  assert.ok(form);
  form.submit = () => { throw new Error('submit() was called'); };
  form.addEventListener('submit', () => { throw new Error('submit event dispatched'); });
  await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
});

test('a non-empty control is preserved by default', async () => {
  const { doc, resolution } = setup();
  inputEl(doc, 'attribute2445').value = 'someoneelse';
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(row(rows, 'ubitName')?.status, 'preserved');
  assert.equal(inputEl(doc, 'attribute2445').value, 'someoneelse');
});

test('the overwrite toggle replaces an existing value', async () => {
  const { doc, resolution } = setup();
  inputEl(doc, 'attribute2445').value = 'someoneelse';
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings({ overwrite: true }) }, { bridge });
  assert.equal(row(rows, 'ubitName')?.status, 'filled');
  assert.equal(inputEl(doc, 'attribute2445').value, 'duynghie');
});

test('a missing UBITName falls back to the value the field itself asks for', async () => {
  const { doc, resolution } = setup();
  const rows = await runFill({ resolution, requestor: { ...REQUESTOR, ubitName: null }, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(row(rows, 'ubitName')?.status, 'filled');
  assert.equal(inputEl(doc, 'attribute2445').value, 'Unknown');
});

test('no confirmed service means the field is reported, not guessed', async () => {
  const { doc, resolution } = setup();
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: null, settings: settings() }, { bridge });
  const r = row(rows, 'service');
  assert.ok(r);
  assert.equal(r.status, 'needs-confirm');
  assert.match(r.detail, /confirm/i);
  assert.equal(inputEl(doc, 'attribute789').value, '288', 'the TDX prefill must be left exactly as it was');
});

test('an unresolved field is reported as unresolved, not written somewhere plausible', async () => {
  const doc = loadFixture();
  doc.getElementById('attribute2445-grp')?.remove();
  doc.getElementById('attribute2445')?.closest('.form-group')?.remove();
  const { resolution } = setup(doc);
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  const r = row(rows, 'ubitName');
  assert.ok(r);
  assert.equal(r.status, 'skipped');
  assert.match(r.detail, /not found|unresolved/i);
});

test('out-of-scope resolved fields are reported so the technician sees them', async () => {
  const { resolution } = setup();
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  for (const key of ['impact', 'urgency', 'status', 'location']) {
    const r = row(rows, key);
    assert.ok(r, `${key} not reported`);
    assert.equal(r.status, 'skipped');
  }
});

test('planFill writes nothing to the DOM', () => {
  const { doc, resolution } = setup();
  const before = inputEl(doc, 'attribute37').value;
  planFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() });
  assert.equal(inputEl(doc, 'attribute37').value, before);
});

test('an adapter failure surfaces as failed with the mismatch, not as success', async () => {
  const { doc, resolution } = setup();
  const el = inputEl(doc, 'attribute2445');
  el.addEventListener('change', () => { el.value = ''; });
  const rows = await runFill({ resolution, requestor: REQUESTOR, template: EDUROAM, service: SERVICE, settings: settings() }, { bridge });
  assert.equal(row(rows, 'ubitName')?.status, 'failed');
  assert.match(row(rows, 'ubitName')?.detail ?? '', /read back/i);
});
