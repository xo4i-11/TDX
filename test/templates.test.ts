// Tests that shipped templates carry the right verified language and that placeholder substitution escapes correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, SHIPPED_TEMPLATES, substitute } from '../src/data/templates.ts';
import type { RequestorFields, Template } from '../src/types.ts';

const REQUESTOR: RequestorFields = {
  name: 'Anh Duy Nghiem',
  email: 'duynghie@buffalo.edu',
  ubitName: 'duynghie',
  personNumber: '50583450',
  personGuid: 'b067308b-2198-ef11-9c36-f06ebc4e4310',
  title: 'Student Assistant',
  organization: 'University at Buffalo',
};

test('ships a blank template plus the three walk-up templates', () => {
  assert.equal(SHIPPED_TEMPLATES.length, 4);
  const names = SHIPPED_TEMPLATES.map((t) => t.name);
  assert.ok(names.some((n) => /blank/i.test(n)));
  assert.ok(names.some((n) => /eduroam/i.test(n)));
  assert.ok(names.some((n) => /password/i.test(n)));
  assert.ok(names.some((n) => /duo/i.test(n)));
});

test('every shipped template ships with no service, because ids are captured not invented', () => {
  for (const t of SHIPPED_TEMPLATES) assert.equal(t.service, null, `${t.name} must not ship a guessed service id`);
});

test('shipped descriptions are past-tense notes naming what was verified', () => {
  const eduroam = SHIPPED_TEMPLATES.find((t) => /eduroam/i.test(t.name));
  assert.ok(eduroam);
  assert.match(eduroam.descriptionHtml, /confirmed/i);
  assert.match(eduroam.descriptionHtml, /CAT/);
  const password = SHIPPED_TEMPLATES.find((t) => /password/i.test(t.name));
  assert.ok(password);
  assert.match(password.descriptionHtml, /photo ID/i);
  assert.match(password.descriptionHtml, /never sees/i);
});

test('substitute replaces every supported placeholder', () => {
  const { text, unknown } = substitute(
    '{{name}} / {{ubitName}} / {{email}} / {{personNumber}} / {{date}}',
    { ...REQUESTOR, date: '2026-09-04' },
  );
  assert.equal(text, 'Anh Duy Nghiem / duynghie / duynghie@buffalo.edu / 50583450 / 2026-09-04');
  assert.deepEqual(unknown, []);
});

test('an unknown placeholder is left literal and reported, never blanked', () => {
  const { text, unknown } = substitute('Hello {{nmae}}', { ...REQUESTOR });
  assert.equal(text, 'Hello {{nmae}}');
  assert.deepEqual(unknown, ['nmae']);
});

test('a known placeholder with no value is left literal and reported', () => {
  const { text, unknown } = substitute('UBIT: {{ubitName}}', { ...REQUESTOR, ubitName: null });
  assert.equal(text, 'UBIT: {{ubitName}}');
  assert.deepEqual(unknown, ['ubitName']);
});

test('values substituted into HTML are escaped', () => {
  const { text } = substitute('<p>{{name}}</p>', { name: 'A <script>alert(1)</script> B' }, { escape: true });
  assert.ok(!text.includes('<script>'));
  assert.match(text, /&lt;script&gt;/);
});

// Falsifiability: a broken or removed escape function would leave these raw characters
// in the output, so this fails loudly if `escape` stops doing its job on any of them.
test('escaping covers all five HTML-significant characters', () => {
  const { text } = substitute('{{name}}', { name: `<>&"'` }, { escape: true });
  assert.equal(text, '&lt;&gt;&amp;&quot;&#39;');
});

test('renderTemplate fills summary and description and reports unknowns once', () => {
  const template: Template = {
    id: 't',
    name: 'T',
    summary: 'eduroam setup for {{ubitName}}',
    descriptionHtml: '<p>Configured eduroam for {{name}} on {{date}}. {{oops}}</p>',
    service: null,
  };
  const out = renderTemplate(template, REQUESTOR, { now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(out.summary, 'eduroam setup for duynghie');
  assert.match(out.descriptionHtml, /Anh Duy Nghiem/);
  assert.match(out.descriptionHtml, /2026-09-04/);
  assert.deepEqual(out.unknown, ['oops']);
});

// Falsifiability: if renderTemplate escaped the summary too, this literal ampersand
// would come back as `&amp;` and the equality check below would fail.
test('the summary is plain text and is not HTML-escaped', () => {
  const template: Template = {
    id: 't', name: 'T', summary: 'Ticket for {{name}}', descriptionHtml: '<p>{{name}}</p>', service: null,
  };
  const out = renderTemplate(template, { ...REQUESTOR, name: 'Smith & Sons' });
  assert.equal(out.summary, 'Ticket for Smith & Sons');
  assert.match(out.descriptionHtml, /Smith &amp; Sons/);
});

// Falsifiability: if renderTemplate ignored the injected `now` and read the real clock
// instead, both calls below would render today's date and this test would fail because
// neither fixture date is today (2026-09-04, chosen when this test was written).
test('renderTemplate uses the injected clock, not the real one', () => {
  const template: Template = {
    id: 't', name: 'T', summary: '{{date}}', descriptionHtml: '', service: null,
  };
  const past = renderTemplate(template, REQUESTOR, { now: new Date('1999-01-01T00:00:00Z') });
  const future = renderTemplate(template, REQUESTOR, { now: new Date('2099-12-31T00:00:00Z') });
  assert.equal(past.summary, '1999-01-01');
  assert.equal(future.summary, '2099-12-31');
});
