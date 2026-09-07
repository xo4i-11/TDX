// Tests the red-placeholder detection and rewrite that turns a captured TDX
// "Ticket Resolved" body into an ordinary {{steps}} template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findRedBlocks, toStepsTemplate } from '../src/data/resolved.ts';

const doc = new JSDOM('').window.document;

const REDS: [string, string][] = [
  ['hex short', '<p><span style="color:#c00">what you tried</span></p>'],
  ['hex long', '<p><span style="color:#FF0000">what you tried</span></p>'],
  ['rgb', '<p><span style="color: rgb(192, 0, 0)">what you tried</span></p>'],
  ['named', '<p><span style="color:red">what you tried</span></p>'],
  ['font tag', '<p><font color="red">what you tried</font></p>'],
];

for (const [name, html] of REDS) {
  test(`red is detected as ${name}`, () => {
    const blocks = findRedBlocks(`<p>Hello</p>${html}<p>Bye</p>`, doc);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.text, 'what you tried');
  });
}

// Falsifiability: if the colour test were "has any colour", this blue run would
// match and every captured template would silently lose a paragraph.
test('non-red colours are not placeholders', () => {
  assert.deepEqual(findRedBlocks('<p><span style="color:#0000cc">blue</span></p>', doc), []);
});

test('the whole block is replaced, not just the coloured run', () => {
  const out = toStepsTemplate('<p>Hi</p><p>We <span style="color:red">tried things</span> today</p>', doc, 0);
  assert.match(out, /<p>Hi<\/p>/);
  assert.equal(out.includes('today'), false, 'the block holding the red run must go, or a <ul> lands inside a <p>');
  assert.match(out, /\{\{steps\}\}/);
});

test('two red blocks are both reported so the technician can choose', () => {
  const blocks = findRedBlocks('<p><span style="color:red">one</span></p><div><span style="color:#c00">two</span></div>', doc);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.text), ['one', 'two']);
});

test('toStepsTemplate rewrites only the chosen block', () => {
  const out = toStepsTemplate('<p><span style="color:red">one</span></p><p><span style="color:red">two</span></p>', doc, 1);
  assert.match(out, /one/);
  assert.equal(out.includes('two'), false);
  assert.equal(out.match(/\{\{steps\}\}/g)?.length, 1);
});

test('a body with no red is left alone and reports nothing', () => {
  assert.deepEqual(findRedBlocks('<p>plain</p>', doc), []);
  assert.equal(toStepsTemplate('<p>plain</p>', doc, 0), '<p>plain</p>');
});
