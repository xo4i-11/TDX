// Tests reading one comment template out of TDX's own page data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadUpdateFixture } from './helpers.ts';
import { findTemplateLink, readTemplateHtml } from '../src/adapters/tdx-templates.ts';

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

// The whole point of reading the page data rather than clicking the menu: no
// CKEditor, no jQuery, no Mustache, no waiting — this runs in jsdom, against
// the real inline block TDX ships.
test('reads the Ticket Resolved body out of the page, with its red placeholder intact', () => {
  const found = readTemplateHtml(loadUpdateFixture(), 'Ticket Resolved', 'ALL');
  assert.ok(!('error' in found), `expected a body, got ${JSON.stringify(found)}`);
  assert.match(found.html, /Your ticket has been resolved/);
  assert.match(found.html, /color:#ff0000/, 'the red placeholder is what the steps get substituted into');
});

test('substitutes the values TDX would have substituted, including a null one', () => {
  const doc = new JSDOM(`
    <ul><li class="dropdown-submenu"><a>ALL</a><ul>
      <li><a class="js-template" data-template-id="61">Ticket Resolved</a></li>
    </ul></li></ul>
    <script>
      var responseTemplates = {};
      responseTemplates[61] = "Hello {{RequestorFirstName}},<br />{{{TechnicianSignature}}}{{Unknown}}";
      $(".js-entry-form").TicketUpdate({
        templateJson: {"RequestorFirstName":"Terry","TechnicianSignature":null},
        responseTemplates: responseTemplates
      });
    </script>`).window.document;

  const found = readTemplateHtml(doc, 'Ticket Resolved', 'ALL');
  assert.ok(!('error' in found));
  // A key the page has no value for stays visible rather than being blanked.
  assert.equal(found.html, 'Hello Terry,<br />{{Unknown}}');
});

// Falsifiability: the bodies are full of escaped quotes from inline style
// attributes. A naive "up to the next quote" read would truncate at the first.
test('a body containing escaped quotes is read whole', () => {
  const doc = new JSDOM(`
    <a class="js-template" data-template-id="7">Ticket Resolved</a>
    <script>
      responseTemplates[7] = "a \\u003cspan style=\\"color:#ff0000\\"\\u003ered\\u003c/span\\u003e b";
    </script>`).window.document;

  const found = readTemplateHtml(doc, 'Ticket Resolved');
  assert.ok(!('error' in found));
  assert.equal(found.html, 'a <span style="color:#ff0000">red</span> b');
});

test('says what was missing rather than returning an empty body', () => {
  const noBody = new JSDOM('<a class="js-template" data-template-id="61">Ticket Resolved</a>').window.document;
  const found = readTemplateHtml(noBody, 'Ticket Resolved');
  assert.ok('error' in found);
  assert.match(found.error, /no body for template 61/);

  const noLink = new JSDOM('<div></div>').window.document;
  const missing = readTemplateHtml(noLink, 'Ticket Resolved', 'ALL');
  assert.ok('error' in missing);
  assert.match(missing.error, /not in this page menu/);
});
