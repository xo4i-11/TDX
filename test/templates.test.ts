// Tests that shipped templates carry the right verified language and that placeholder substitution escapes correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, SHIPPED_TEMPLATES, stepsToHtml, substitute } from '../src/data/templates.ts';
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

test('ships a blank template plus the five walk-up templates', () => {
  assert.equal(SHIPPED_TEMPLATES.length, 6);
  const names = SHIPPED_TEMPLATES.map((t) => t.name);
  assert.ok(names.some((n) => /first time set up eduroam/i.test(n)));
  assert.ok(names.some((n) => /reconfigure eduroam/i.test(n)));
  assert.ok(names.some((n) => /reset password/i.test(n)));
  assert.ok(names.some((n) => /set up duo/i.test(n)));
  assert.ok(names.some((n) => /duo bypass/i.test(n)));
});

test('every shipped template ships with no service, because ids are captured not invented', () => {
  for (const t of SHIPPED_TEMPLATES) assert.equal(t.service, null, `${t.name} must not ship a guessed service id`);
});

// Every walk-up template must name who it was for, their UBITName, and when —
// that is the whole content of the note, so a template missing one is useless.
test('every shipped walk-up template records requestor, UBITName, and timestamp', () => {
  for (const t of SHIPPED_TEMPLATES) {
    if (t.id === 'blank') continue;
    assert.match(t.summary, /\{\{ubitName\}\}/, `${t.name} summary must carry the UBITName`);
    for (const placeholder of ['{{name}}', '{{ubitName}}', '{{time}}', '{{date}}']) {
      assert.ok(t.descriptionHtml.includes(placeholder), `${t.name} description must carry ${placeholder}`);
    }
  }
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
  assert.match(out.descriptionHtml, /09\/04\/2026/);
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
  const past = renderTemplate(template, REQUESTOR, { now: new Date('1999-01-01T12:00:00Z') });
  const future = renderTemplate(template, REQUESTOR, { now: new Date('2099-12-31T12:00:00Z') });
  assert.equal(past.summary, '01/01/1999');
  assert.equal(future.summary, '12/31/2099');
});

// Falsifiability: {{time}} unsupported, or absent from renderTemplate's values,
// would leave the placeholder literal and land it in `unknown`.
test('renderTemplate fills {{time}} as a wall clock reading, not an ISO stamp', () => {
  const template: Template = {
    id: 't', name: 'T', summary: '{{time}}', descriptionHtml: '', service: null,
  };
  const out = renderTemplate(template, REQUESTOR, { now: new Date('2026-09-04T16:30:00Z') });
  assert.match(out.summary, /^\d{1,2}:\d{2}\s?(AM|PM)$/);
  assert.deepEqual(out.unknown, []);
});

test('stepsToHtml makes one bullet per non-blank line and escapes each', () => {
  assert.equal(
    stepsToHtml('Removed the stale profile\n\nRan the CAT tool <b>\n'),
    '<ul><li>Removed the stale profile</li><li>Ran the CAT tool &lt;b&gt;</li></ul>',
  );
});

// Falsifiability: a single line must still be a list, or the fill has two
// shapes to reason about instead of one.
test('a single step is still a list', () => {
  assert.equal(stepsToHtml('Rebooted'), '<ul><li>Rebooted</li></ul>');
});

test('blank steps make no list at all', () => {
  assert.equal(stepsToHtml('  \n \n'), '');
});

test('every walk-up template ships canned steps to pre-fill the resolve box', () => {
  for (const t of SHIPPED_TEMPLATES) {
    if (t.id === 'blank') continue;
    assert.ok((t.steps ?? '').trim(), `${t.name} has no canned steps`);
  }
});

// The five walk-up jobs, in the desk's own words. Pinned because the steps are
// what lands in a client-visible comment.
test('the canned steps are the desk wording, not a paraphrase', () => {
  const steps = (id: string): string => SHIPPED_TEMPLATES.find((t) => t.id === id)?.steps ?? '';
  assert.equal(steps('eduroam'), 'download certificate\nclient was able to connect to eduroam');
  assert.equal(steps('eduroam-reconfigure'), 'Forget the eduroam\nredownload certificate\nclient was able to connect to eduroam');
  assert.equal(steps('password-reset'), 'Verified ID\nReset password\nclient was able to sign in with new password');
  assert.equal(steps('duo'), 'download duo mobile and set up\nclient was able to sign in with duo');
  assert.equal(steps('duo-bypass'), 'verified ID\nAssign Bypass Code to client\nclient was able to sign in with Duo');
});
