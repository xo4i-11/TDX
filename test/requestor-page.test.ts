// Tests reading the requestor off the page, including the case that matters:
// the Requestor card is not in the same document as the form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { harvest } from '../src/core/harvest.ts';
import { resolve } from '../src/core/resolve.ts';
import { readRequestorFromPage } from '../src/data/requestor-page.ts';
import type { Resolution } from '../src/types.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/tdx-form-162.html', import.meta.url));
const FORM_HTML = readFileSync(FIXTURE, 'utf8');

const CARD = `<div class="card"><h3>Requestor</h3>
  <a href="/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310">Anh Duy Nghiem</a>
  <a href="mailto:duynghie@buffalo.edu">duynghie@buffalo.edu</a>
  <div>Student Assistant - ITCX Tech Squad</div>
  <div>University at Buffalo</div>
  <div>50583450 - duynghie</div></div>`;

const resolutionFor = (doc: Document): Resolution => resolve(harvest(doc));

test('reads the card when it sits in the same document as the form', () => {
  const doc = new JSDOM(`<body>${CARD}${FORM_HTML}</body>`).window.document;
  const fields = readRequestorFromPage(doc, resolutionFor(doc));
  assert.equal(fields.ubitName, 'duynghie');
  assert.equal(fields.email, 'duynghie@buffalo.edu');
  assert.equal(fields.personNumber, '50583450');
});

// The real page: TDX renders the ticket form in a nested iframe and the card in
// the page around it. Searching only the form's own document finds a name and a
// GUID and calls everything else missing — the reported bug.
test('reads the card from the parent document when the form is in an iframe', () => {
  const dom = new JSDOM(
    `<body>${CARD}<iframe id="form"></iframe></body>`,
    { runScripts: 'dangerously', resources: 'usable' },
  );
  const iframe = dom.window.document.querySelector('iframe') as HTMLIFrameElement;
  const inner = iframe.contentDocument;
  assert.ok(inner, 'no iframe document');
  inner.body.innerHTML = FORM_HTML;

  const fields = readRequestorFromPage(inner, resolutionFor(inner));
  assert.equal(fields.ubitName, 'duynghie', 'UBITName must come from the card in the parent document');
  assert.equal(fields.email, 'duynghie@buffalo.edu');
  assert.equal(fields.personNumber, '50583450');
});

// Falsifiability: a cross-origin parent throws on .document. That is not an
// error worth surfacing — it just means the card is unreadable from here — so
// the form's own signals must still come back.
test('an unreachable parent still leaves the form-derived fields intact', () => {
  const doc = new JSDOM(`<body>${FORM_HTML}</body>`).window.document;
  Object.defineProperty(doc.defaultView, 'parent', {
    get() { throw new Error('cross-origin'); },
  });

  const fields = readRequestorFromPage(doc, resolutionFor(doc));
  assert.equal(fields.personGuid, 'b067308b-2198-ef11-9c36-f06ebc4e4310');
  assert.equal(fields.ubitName, undefined);
});
