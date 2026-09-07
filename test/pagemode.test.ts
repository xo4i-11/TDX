// Tests the one check that decides which of the two TDX forms the panel is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, loadUpdateFixture } from './helpers.ts';
import { pageMode } from '../src/core/pagemode.ts';

test('the ticket update form is resolve mode', () => {
  assert.equal(pageMode(loadUpdateFixture()), 'resolve');
});

test('the ticket create form is create mode', () => {
  assert.equal(pageMode(loadFixture()), 'create');
});
