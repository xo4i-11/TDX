// Tests that the results panel sorts failures first, explains every row, and outlines exactly the controls that were written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { renderResults, highlightFilled, STATUS_META, type FieldOption } from '../src/ui/results.ts';
import type { Control, FillRow, FillStatus } from '../src/types.ts';

const dom = (): Document => new JSDOM('<body>'
  + '<label for="a">Brief Summary</label><input id="a" name="a">'
  + '<label for="b">Source</label><input id="b" name="b">'
  + '</body>').window.document;

const controlFor = (doc: Document, id: string): Control => {
  const found = harvest(doc).find((c) => c.id === id);
  assert.ok(found, `harvest must find #${id}`);
  return found;
};

const rows = (doc: Document): FillRow[] => [
  { fieldKey: 'briefSummary', label: 'Brief Summary', action: 'write', value: 'hi', status: 'filled', detail: '', control: controlFor(doc, 'a'), confidence: 0.95 },
  { fieldKey: 'source', label: 'Source', action: 'write', value: 'Walkup', status: 'filled', detail: '"Walkup"', control: controlFor(doc, 'b'), confidence: 0.95 },
  { fieldKey: 'service', label: 'Service', action: 'report', value: null, status: 'needs-confirm', detail: 'no confirmed service', control: null, confidence: 0.95 },
  { fieldKey: 'location', label: 'Location', action: 'report', value: null, status: 'failed', detail: 'wrote "139", read back ""', control: null, confidence: 0.4 },
  { fieldKey: 'affiliation', label: 'Affiliation', action: 'report', value: null, status: 'skipped', detail: 'out of fill scope', control: null, confidence: 0.9 },
];

test('renders one row per result with an icon and the detail text', () => {
  const doc = dom();
  const el = renderResults(rows(doc), { doc });
  assert.equal(el.querySelectorAll('.result').length, 5);
  assert.match(el.textContent ?? '', /Brief Summary/);
  assert.match(el.textContent ?? '', /wrote "139", read back ""/);
});

test('problems sort above successes, because the failures are the point', () => {
  const doc = dom();
  const el = renderResults(rows(doc), { doc });
  const names = [...el.querySelectorAll('.result .name')].map((n) => n.textContent);
  assert.ok(names.indexOf('Location') < names.indexOf('Brief Summary'), 'failed row must come first');
  assert.ok(names.indexOf('Service') < names.indexOf('Brief Summary'), 'needs-confirm must come before filled');
});

test('a low-confidence match is flagged with its score even when it filled', () => {
  const doc = dom();
  const el = renderResults(
    [{ fieldKey: 'location', label: 'Location', action: 'write', value: '139', status: 'filled', detail: '', control: controlFor(doc, 'a'), confidence: 0.4 }],
    { doc },
  );
  assert.match(el.textContent ?? '', /0\.4/);
  const result = el.querySelector('.result');
  assert.ok(result);
  assert.equal(result.getAttribute('data-tone'), 'warn');
});

test('every status maps to a tone and an icon', () => {
  const statuses: FillStatus[] = ['filled', 'preserved', 'skipped', 'failed', 'needs-confirm'];
  for (const status of statuses) {
    assert.ok(STATUS_META[status], `no meta for ${status}`);
    assert.ok(STATUS_META[status].icon);
    assert.ok(['good', 'warn', 'bad', 'mute'].includes(STATUS_META[status].tone));
  }
});

test('a correction control reports the control key and the newly chosen field', () => {
  const doc = dom();
  const seen: [string, string][] = [];
  const fieldOptions: FieldOption[] = [{ key: 'location', label: 'Location' }, { key: 'briefSummary', label: 'Brief Summary' }];
  const el = renderResults(rows(doc), {
    doc,
    fieldOptions,
    onCorrect: (controlKey, fieldKey) => seen.push([controlKey, fieldKey]),
  });
  const row = [...el.querySelectorAll('.result')].find((r) => r.textContent?.includes('Brief Summary'));
  assert.ok(row);
  const select = row.querySelector('select');
  assert.ok(select, 'a filled row must offer a correction');
  select.value = 'location';
  const win = doc.defaultView;
  assert.ok(win);
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual(seen, [['a', 'location']]);
});

test('a row with no control gets no correction dropdown even when options are offered', () => {
  const doc = dom();
  const el = renderResults(rows(doc), {
    doc,
    fieldOptions: [{ key: 'location', label: 'Location' }],
    onCorrect: () => {},
  });
  const row = [...el.querySelectorAll('.result')].find((r) => r.textContent?.includes('Service'));
  assert.ok(row);
  assert.equal(row.querySelector('select'), null, 'a row with no matched control cannot be corrected');
});

test('highlightFilled outlines the controls that were written and nothing else', () => {
  const doc = dom();
  const all = rows(doc);
  highlightFilled(all, doc);
  assert.ok(doc.getElementById('a')?.classList.contains('tdxa-touched'));
  assert.ok(doc.getElementById('b')?.classList.contains('tdxa-touched'));
  assert.equal(doc.querySelectorAll('.tdxa-touched').length, 2);
});

test('highlightFilled clears a stale outline from a previous fill before applying the new one', () => {
  const doc = dom();
  const all = rows(doc);
  highlightFilled(all, doc);
  // Second run only "b" was actually filled — "a" must lose its outline, not keep it.
  const onlyB = all.filter((r) => r.fieldKey !== 'briefSummary');
  highlightFilled(onlyB, doc);
  assert.equal(doc.getElementById('a')?.classList.contains('tdxa-touched'), false);
  assert.ok(doc.getElementById('b')?.classList.contains('tdxa-touched'));
  assert.equal(doc.querySelectorAll('.tdxa-touched').length, 1);
});

test('highlightFilled injects its stylesheet once, not once per fill', () => {
  const doc = dom();
  highlightFilled(rows(doc), doc);
  highlightFilled(rows(doc), doc);
  assert.equal(doc.querySelectorAll('style[data-tdxa-highlight]').length, 1);
});
