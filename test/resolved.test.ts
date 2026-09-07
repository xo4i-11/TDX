// Tests the red-placeholder rewrite that turns TDX's loaded "Ticket Resolved"
// body into a {{steps}} template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isBlankHtml, toStepsTemplate } from '../src/data/resolved.ts';

const doc = new JSDOM('').window.document;

const REDS: [string, string][] = [
  ['hex short', '<p><span style="color:#c00">what you tried</span></p>'],
  ['hex long', '<p><span style="color:#FF0000">what you tried</span></p>'],
  ['rgb', '<p><span style="color: rgb(192, 0, 0)">what you tried</span></p>'],
  ['named', '<p><span style="color:red">what you tried</span></p>'],
  ['font tag', '<p><font color="red">what you tried</font></p>'],
];

for (const [name, html] of REDS) {
  test(`red is found as ${name}`, () => {
    const out = toStepsTemplate(`<p>Hello</p>${html}<p>Bye</p>`, doc);
    assert.match(out, /{{steps}}/);
    assert.equal(out.includes('what you tried'), false);
  });
}

// Falsifiability: if the colour test were "has any colour", this blue run would
// match and the resolution would lose a paragraph of TDX wording.
test('non-red colours are not placeholders', () => {
  const html = '<p><span style="color:#0000cc">blue</span></p>';
  assert.equal(toStepsTemplate(html, doc), html);
});

test('the whole block is replaced, not just the coloured run', () => {
  const out = toStepsTemplate('<p>Hi</p><p>We <span style="color:red">tried things</span> today</p>', doc);
  assert.ok(out.includes('<p>Hi</p>'));
  assert.equal(out.includes('today'), false, 'the block holding the red run must go, or a <ul> lands inside a <p>');
});

// The steps replace red text, so a black list would read as canned wording
// rather than as what the technician did.
test('the placeholder keeps the red it replaced, on a div a list can live in', () => {
  const out = toStepsTemplate('<p><span style="color:#c00">steps taken</span></p>', doc);
  assert.ok(/<div[^>]*>\{\{steps\}\}<\/div>/.test(out), 'the placeholder must be a div, so a list can live inside it');
  assert.match(out, /color:\s*#c00/i);
});

test('only the first red block becomes the placeholder', () => {
  const out = toStepsTemplate('<p><span style="color:red">one</span></p><p><span style="color:red">two</span></p>', doc);
  assert.equal(out.match(/{{steps}}/g)?.length, 1);
  assert.match(out, /two/);
});

test('a body with no red is left exactly as it was', () => {
  assert.equal(toStepsTemplate('<p>plain</p>', doc), '<p>plain</p>');
});

// Falsifiability: CKEditor never leaves its body truly empty — it seeds a
// placeholder paragraph. Treating that as content is what made the panel skip
// its own template load on every fresh ticket.
test('an editor holding only CKEditor placeholder markup counts as blank', () => {
  for (const html of ['', '   ', '<p><br></p>', '<p>&nbsp;</p>', '<p><br /></p>', '<div><p>\n</p></div>']) {
    assert.equal(isBlankHtml(html), true, `${JSON.stringify(html)} should be blank`);
  }
});

test('real content is not blank', () => {
  for (const html of ['<p>Half a comment</p>', '<p><span style="color:red">x</span></p>', 'text']) {
    assert.equal(isBlankHtml(html), false, `${JSON.stringify(html)} should not be blank`);
  }
});
