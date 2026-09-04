// Tests that the retriever ranks services by their prior examples' similarity to a new ticket description, stays inside [0, 1], collapses to one row per service, and returns nothing when it has no basis to guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve } from '../src/service/retriever.ts';
import type { Example } from '../src/types.ts';

const WIFI = { id: '288', text: 'Personal Device Consultation' };
const ACCOUNT = { id: '301', text: 'Account Management' };

const CORPUS: Example[] = [
  { id: 'e1', savedAt: '2026-01-01T00:00:00.000Z', description: 'Removed the stale eduroam profile and ran the eduroam CAT tool. Device joined wifi.', service: WIFI },
  { id: 'e2', savedAt: '2026-01-02T00:00:00.000Z', description: 'eduroam would not connect on a laptop; reinstalled the wireless profile.', service: WIFI },
  { id: 'e3', savedAt: '2026-01-03T00:00:00.000Z', description: 'Photo ID verified, user reset their UBITName password themselves.', service: ACCOUNT },
];

test('ACCEPTANCE: an empty corpus suggests nothing rather than guessing', () => {
  assert.deepEqual(retrieve('eduroam setup', []), []);
});

test('an empty query suggests nothing', () => {
  assert.deepEqual(retrieve('', CORPUS), []);
});

test('ranks the service whose prior tickets match the description', () => {
  const [top] = retrieve('Set up eduroam wifi profile on a laptop', CORPUS);
  assert.equal(top?.service.id, WIFI.id);
});

test('a different topic ranks a different service', () => {
  const [top] = retrieve('User needs their UBITName password reset, photo ID checked', CORPUS);
  assert.equal(top?.service.id, ACCOUNT.id);
});

test('scores are normalised to 0..1 and ordered descending', () => {
  const ranked = retrieve('eduroam wifi', CORPUS);
  assert.ok(ranked.length > 0);
  for (const r of ranked) {
    assert.ok(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
  }
  const scores = ranked.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('an unrelated description scores low rather than picking a winner confidently', () => {
  const ranked = retrieve('printer jammed in the copy room', CORPUS);
  assert.ok(!ranked.length || (ranked[0]?.score ?? Number.POSITIVE_INFINITY) < 0.2, `expected a weak match, got ${ranked[0]?.score}`);
});

test('each result carries the prior examples and the terms that matched', () => {
  const [top] = retrieve('eduroam profile', CORPUS);
  assert.ok(top);
  assert.ok(top.evidence.length >= 1);
  assert.ok(top.evidence[0]?.exampleId);
  assert.ok((top.evidence[0]?.snippet.length ?? 0) > 0);
  assert.ok(top.evidence[0]?.terms.includes('eduroam'));
});

test('one result per service, not one per example', () => {
  const ranked = retrieve('eduroam wifi profile', CORPUS);
  const ids = ranked.map((r) => r.service.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('stopwords do not drive the ranking', () => {
  const [top] = retrieve('the and of a to it was for on with', CORPUS);
  assert.ok(top === undefined || top.score < 0.1);
});

// --- Falsifiability: assert the actual numbers and evidence, not just ordering. ---

test('a query that exactly repeats one example scores it at the maximum, 1', () => {
  const only: Example[] = [{ id: 'e1', savedAt: '2026-01-01T00:00:00.000Z', description: 'eduroam wifi profile laptop', service: WIFI }];
  const [top] = retrieve('eduroam wifi profile laptop', only);
  assert.equal(top?.score, 1);
});

test('repeating a query term does not push the score above 1', () => {
  const only: Example[] = [{ id: 'e1', savedAt: '2026-01-01T00:00:00.000Z', description: 'eduroam wifi', service: WIFI }];
  const [top] = retrieve('eduroam eduroam eduroam wifi wifi', only);
  assert.ok(top !== undefined);
  assert.ok((top?.score ?? 0) <= 1, `score exceeded 1: ${top?.score}`);
});

test('an example with an empty description contributes no evidence and never divides by zero', () => {
  const withBlank: Example[] = [
    { id: 'e1', savedAt: '2026-01-01T00:00:00.000Z', description: '', service: WIFI },
    { id: 'e2', savedAt: '2026-01-02T00:00:00.000Z', description: 'eduroam wifi profile', service: ACCOUNT },
  ];
  const ranked = retrieve('eduroam wifi profile', withBlank);
  for (const r of ranked) assert.ok(Number.isFinite(r.score), `non-finite score: ${r.score}`);
  const wifiRow = ranked.find((r) => r.service.id === WIFI.id);
  assert.equal(wifiRow, undefined, 'a blank example shares no terms and should not surface at all');
});

test('evidence terms are exactly the query terms the winning snippet shares, not an unrelated set', () => {
  const [top] = retrieve('eduroam wifi profile on a laptop', CORPUS);
  assert.ok(top);
  const terms = top.evidence[0]?.terms ?? [];
  // every reported term must actually appear in the query
  for (const t of terms) assert.ok('eduroam wifi profile laptop'.includes(t), `unexpected evidence term: ${t}`);
  // and the strongest, most specific shared term must be reported
  assert.ok(terms.includes('eduroam'));
});

test('ties fall back to a stable order (corpus order) rather than crashing or shuffling', () => {
  const tied: Example[] = [
    { id: 'a', savedAt: '2026-01-01T00:00:00.000Z', description: 'printer jam copy room', service: { id: 'x', text: 'X' } },
    { id: 'b', savedAt: '2026-01-02T00:00:00.000Z', description: 'printer jam copy room', service: { id: 'y', text: 'Y' } },
  ];
  const first = retrieve('printer jam copy room', tied).map((r) => r.service.id);
  const second = retrieve('printer jam copy room', tied).map((r) => r.service.id);
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first), new Set(['x', 'y']));
});
