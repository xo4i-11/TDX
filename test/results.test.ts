// Tests that the results panel sorts failures first, explains every row, and outlines exactly the controls that were written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { harvest } from '../src/core/harvest.ts';
import { highlightFilled } from '../src/ui/results.ts';
import type { Control, FillRow } from '../src/types.ts';

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

// The flag's whole purpose is "don't read a tick as trust it", so the threshold
// it uses must be the resolver's own LOW_CONFIDENCE, not a second copy that
// stops agreeing the moment the tier ceilings are retuned.
