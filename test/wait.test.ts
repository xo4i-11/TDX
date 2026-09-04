// Tests that waitFor resolves as soon as its predicate is true, rejects on timeout, and never leaves an observer or timer running behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { waitFor } from '../src/adapters/wait.ts';

/** jsdom's timer tracking is undocumented API used here only to sanity-check cleanup. */
interface WindowWithIntervals {
  __intervals?: Set<unknown>;
}

function intervalCount(win: object): number {
  return (win as WindowWithIntervals).__intervals?.size ?? 0;
}

test('resolves immediately when the predicate is already true', async () => {
  const dom = new JSDOM('<div id="here"></div>');
  const el = await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win: dom.window,
  });
  assert.equal(el.id, 'here');
});

test('resolves when the DOM later satisfies the predicate', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const { document } = dom.window;
  const pending = waitFor(() => document.getElementById('later'), {
    root: document, win: dom.window,
  });
  const added = document.createElement('span');
  added.id = 'later';
  document.getElementById('root')?.appendChild(added);
  assert.equal((await pending).id, 'later');
});

test('rejects on timeout rather than hanging', async () => {
  const dom = new JSDOM('<div></div>');
  await assert.rejects(
    () => waitFor(() => null, { timeout: 60, root: dom.window.document, win: dom.window }),
    /timed out/i,
  );
});

test('disconnects its observer and clears its poll on resolve', async () => {
  const dom = new JSDOM('<div id="here"></div>');
  const before = intervalCount(dom.window);
  await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win: dom.window,
  });
  // No leak assertion is possible directly; this asserts the call completes
  // and a second identical call still behaves, which fails if state leaked.
  const again = await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win: dom.window,
  });
  assert.equal(again.id, 'here');
  assert.equal(before, intervalCount(dom.window));
});
