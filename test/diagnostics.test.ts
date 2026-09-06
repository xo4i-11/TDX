// Tests that the diagnostics dump is pasteable plain text and that each control's block actually carries the resolver's reasoning — winner, tier, confidence, and named runners-up — not just words that happen to appear somewhere in the dump.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFixture } from './helpers.ts';
import { harvest } from '../src/core/harvest.ts';
import { resolve } from '../src/core/resolve.ts';
import { formSignature } from '../src/core/signature.ts';
import { formatDiagnostics, renderDiagnostics } from '../src/ui/diagnostics.ts';

const dump = (): string => {
  const doc = loadFixture();
  return formatDiagnostics(resolve(harvest(doc)), { signature: formSignature(doc) });
};

/** Isolates the block for one control (by its DOM id) out of the whole dump, so an assertion can't be satisfied by a different control's line. */
function blockFor(text: string, id: string): string {
  const parts = text.split(/\n(?=- )/);
  const found = parts.find((part) => new RegExp(`\\bid=${id}\\b`).test(part));
  assert.ok(found, `no diagnostics block found for id=${id}`);
  return found;
}

test('the dump is plain text, so it pastes into a ticket or a chat unchanged', () => {
  const text = dump();
  assert.equal(typeof text, 'string');
  assert.ok(!text.includes('<'), 'must contain no markup');
});

test('the form signature is included so a learned mapping can be traced', () => {
  const doc = loadFixture();
  const signature = formSignature(doc);
  assert.ok(dump().includes(signature));
});

// attribute37 (Brief Summary) resolves via tier 1 on data-fieldtype="title".
// Every value asserted here comes from resolve.ts's TIER_FIELDTYPE constant
// and the dictionary's briefSummary entry, not from a word that happens to
// occur elsewhere in the dump.
test('a control resolved via tier 1 shows its label, markers, winning field, tier, and confidence in its own block', () => {
  const block = blockFor(dump(), 'attribute37');
  assert.match(block, /^- Brief Summary$/m, 'label line');
  assert.match(block, /id=attribute37 {2}name=attribute37 {2}shape=text/, 'identity line');
  assert.match(block, /data-fieldtype=title {2}data-fieldid=37/, 'marker line');
  assert.match(block, /-> briefSummary {2}confidence=0\.95 {2}tier=1 {2}\(data-fieldtype="title"\)/, 'winner line');
});

// attribute702 (Location Room) is a tier-3 match with a genuine, scored
// runner-up ("location"), so this proves the runners-up line carries real
// evidence rather than the word "runners-up" appearing anywhere in the dump.
test('a near-miss field is recorded as a runner-up with its own score, inside the winning control\'s block', () => {
  const block = blockFor(dump(), 'attribute702');
  assert.match(block, /-> locationRoom/, 'winner line');
  assert.match(block, /runners-up: location=0\.7/, 'runner-up line names the field and its score');
});

// FormID has no dictionary entry that could ever match it, so it must always
// come back unresolved — this is not a fixture-order fluke.
test('a control the resolver could not match is shown as unresolved, not omitted', () => {
  const block = blockFor(dump(), 'FormID');
  assert.match(block, /-> unresolved/);
  assert.match(block, /runners-up: none/);
});

// The fixture's "Responsible" field has no corresponding control on this
// particular form, per resolve()'s unresolvedFields — that must be named,
// not silently absent from the dump.
test('a canonical field with no control on this form is named in the summary', () => {
  assert.match(dump(), /fields with no control on this form: .*\bresponsible\b/);
});

test('renderDiagnostics produces a pre plus a working copy button', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  const view = doc.defaultView;
  assert.ok(view);
  const copied: string[] = [];
  Object.defineProperty(view.navigator, 'clipboard', {
    value: { writeText: async (t: string) => { copied.push(t); } },
    configurable: true,
  });

  const el = renderDiagnostics('hello diagnostics', { doc });
  const pre = el.querySelector('pre.diagnostics');
  assert.ok(pre);
  assert.equal(pre.textContent, 'hello diagnostics');

  const button = el.querySelector('button');
  assert.ok(button);
  button.click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(copied, ['hello diagnostics']);
});

// The dump is built to be pasted into a ticket, a chat, or an issue. A TDX
// ticket-form URL carries RequestorUID=<person GUID> — the one identifier this
// project refuses to persist anywhere — so the query string must never survive
// into the text. jsdom fixtures load at about:blank, so the URL is passed in
// explicitly here; that is exactly why nothing caught this before.
test('the page URL is stripped to its path, so the requestor GUID in RequestorUID cannot ride along', () => {
  const doc = loadFixture();
  const guid = 'b067308b-2198-ef11-9c36-f06ebc4e4310';
  const url = `https://ubuffalo.teamdynamix.com/TDNext/Apps/40/Tickets/New?TicketFormID=162&RequestorUID=${guid}&U=abc`;
  const text = formatDiagnostics(resolve(harvest(doc)), { signature: formSignature(doc), url });

  assert.ok(!text.includes(guid), 'the requestor person GUID must not appear in the dump');
  assert.ok(!text.includes('RequestorUID'), 'the query string must not appear in the dump');
  assert.match(text, /^page: https:\/\/ubuffalo\.teamdynamix\.com\/TDNext\/Apps\/40\/Tickets\/New$/m, 'the path is still recorded');
});
