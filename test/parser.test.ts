// Tests that the requestor parser extracts the right fields from both TDX paste formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestor } from '../src/data/parser.ts';

const MARKDOWN_BLOCK = `Requestor
[Anh Duy Nghiem](https://ubuffalo.teamdynamix.com/TDNext/Apps/People/PersonDet.aspx?U=b067308b-2198-ef11-9c36-f06ebc4e4310)
[duynghie@buffalo.edu](mailto:duynghie@buffalo.edu)
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

const PLAIN_BLOCK = `Requestor
Anh Duy Nghiem
duynghie@buffalo.edu
Student Assistant - ITCX Tech Squad
University at Buffalo
50583450 - duynghie`;

test('markdown block yields all seven fields including the GUID', () => {
  const { fields, warnings } = parseRequestor(MARKDOWN_BLOCK);
  assert.equal(fields.name, 'Anh Duy Nghiem');
  assert.equal(fields.email, 'duynghie@buffalo.edu');
  assert.equal(fields.personGuid, 'b067308b-2198-ef11-9c36-f06ebc4e4310');
  assert.equal(fields.personNumber, '50583450');
  assert.equal(fields.ubitName, 'duynghie');
  assert.equal(fields.title, 'Student Assistant - ITCX Tech Squad');
  assert.equal(fields.organization, 'University at Buffalo');
  assert.deepEqual(warnings, []);
});

test('plain-text block yields everything except the GUID, and warns', () => {
  const { fields, warnings } = parseRequestor(PLAIN_BLOCK);
  assert.equal(fields.name, 'Anh Duy Nghiem');
  assert.equal(fields.email, 'duynghie@buffalo.edu');
  assert.equal(fields.personNumber, '50583450');
  assert.equal(fields.ubitName, 'duynghie');
  assert.equal(fields.personGuid, null);
  assert.ok(warnings.some((w) => /guid/i.test(w)));
});

test('UBITName comes from the ID line, not the email local part', () => {
  // Aliases exist. The ID line is authoritative; the email may be an alias.
  const aliased = PLAIN_BLOCK.replace('duynghie@buffalo.edu', 'anh.nghiem@buffalo.edu');
  const { fields } = parseRequestor(aliased);
  assert.equal(fields.email, 'anh.nghiem@buffalo.edu');
  assert.equal(fields.ubitName, 'duynghie');
});

test('a malformed paste returns partial fields and warnings instead of throwing', () => {
  const { fields, warnings } = parseRequestor('just some garbage text');
  assert.equal(fields.email, null);
  assert.equal(fields.ubitName, null);
  assert.ok(warnings.length >= 3);
});

test('empty input is handled', () => {
  const { fields, warnings } = parseRequestor('');
  assert.equal(fields.name, null);
  assert.ok(warnings.length > 0);
});

test('the Requestor header line is not mistaken for the name', () => {
  const { fields } = parseRequestor(MARKDOWN_BLOCK);
  assert.notEqual(fields.name, 'Requestor');
});
