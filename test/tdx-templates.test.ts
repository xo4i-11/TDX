// Tests finding and clicking one entry in TDX's own comment-template menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadUpdateFixture } from './helpers.ts';
import { findTemplateLink, applyTemplate } from '../src/adapters/tdx-templates.ts';

// Falsifiability: "Ticket Resolved", "Ticket Resolved - No Response" and
// "@Ticket Resolved" all exist in this menu. A substring match would pick
// whichever the DOM happened to list first.
test('finds Ticket Resolved exactly, not its longer namesakes', () => {
  const link = findTemplateLink(loadUpdateFixture(), 'Ticket Resolved', 'ALL');
  assert.ok(link, 'Ticket Resolved not found in the fixture menu');
  assert.equal((link.textContent ?? '').trim(), 'Ticket Resolved');
});

test('prefers the named group when the same name appears in several', () => {
  const doc = new JSDOM(`
    <ul>
      <li class="dropdown-submenu"><a>ACO</a><ul>
        <li><a class="js-template" data-template-id="1">Ticket Resolved</a></li>
      </ul></li>
      <li class="dropdown-submenu"><a>ALL</a><ul>
        <li><a class="js-template" data-template-id="61">Ticket Resolved</a></li>
      </ul></li>
    </ul>`).window.document;
  assert.equal(findTemplateLink(doc, 'Ticket Resolved', 'ALL')?.dataset.templateId, '61');
});

test('reports nothing rather than guessing when the template is absent', () => {
  const doc = new JSDOM('<ul><li><a class="js-template">Something Else</a></li></ul>').window.document;
  assert.equal(findTemplateLink(doc, 'Ticket Resolved', 'ALL'), null);
});

test('applyTemplate clicks the link and resolves once the editor changes', async () => {
  const doc = new JSDOM('<a class="js-template" data-template-id="61">Ticket Resolved</a>').window.document;
  const link = doc.querySelector('a');
  assert.ok(link);

  let body = '';
  // Stand in for TDX: the click triggers a fetch that later fills the editor.
  link.addEventListener('click', () => { setTimeout(() => { body = '<p>Resolved boilerplate</p>'; }, 10); });

  const result = await applyTemplate(link, () => body, { timeout: 1000 });
  assert.equal(result.ok, true);
  assert.equal(body, '<p>Resolved boilerplate</p>');
});

// Falsifiability: without the wait, a click that TDX never answers would be
// reported as success and the fill would substitute into an empty body.
test('applyTemplate reports failure when the editor never changes', async () => {
  const doc = new JSDOM('<a class="js-template">Ticket Resolved</a>').window.document;
  const link = doc.querySelector('a');
  assert.ok(link);

  const result = await applyTemplate(link, () => '', { timeout: 200 });
  assert.equal(result.ok, false);
  assert.match(result.detail, /did not change/);
});
