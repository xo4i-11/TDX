// Tests that waitFor resolves as soon as its predicate is true, rejects on timeout, and never leaves an observer or timer running behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { DOMWindow } from 'jsdom';
import { waitFor } from '../src/adapters/wait.ts';

interface Calls {
  intervalsSet: number;
  intervalsCleared: number;
  timeoutsSet: number;
  timeoutsCleared: number;
  disconnects: number;
}

/**
 * jsdom keeps no public record of live timers or observers (an earlier
 * version of this test read a private `__intervals` property that jsdom
 * v25 never sets, so it always compared 0 to 0 and could not fail). This
 * wraps one jsdom window's own timer/observer surface so cleanup can be
 * checked directly: everything here still delegates to the real window, it
 * just counts.
 */
function instrument(real: DOMWindow): { win: DOMWindow; calls: Calls } {
  const calls: Calls = {
    intervalsSet: 0, intervalsCleared: 0, timeoutsSet: 0, timeoutsCleared: 0, disconnects: 0,
  };

  const RealObserver = real.MutationObserver as { new (callback: MutationCallback): MutationObserver };
  class TrackedObserver extends RealObserver {
    disconnect(): void {
      calls.disconnects += 1;
      super.disconnect();
    }
  }

  const setInterval: Window['setInterval'] = (handler, timeout) => {
    calls.intervalsSet += 1;
    return real.setInterval(handler, timeout);
  };
  const clearInterval: Window['clearInterval'] = (id) => {
    calls.intervalsCleared += 1;
    real.clearInterval(id);
  };
  const setTimeout: Window['setTimeout'] = (handler, timeout) => {
    calls.timeoutsSet += 1;
    return real.setTimeout(handler, timeout);
  };
  const clearTimeout: Window['clearTimeout'] = (id) => {
    calls.timeoutsCleared += 1;
    real.clearTimeout(id);
  };

  // A structural stand-in for DOMWindow: waitFor only ever touches these five
  // members (see WaitWindow in wait.ts), so nothing else needs wrapping.
  const win = { MutationObserver: TrackedObserver, setInterval, clearInterval, setTimeout, clearTimeout } as DOMWindow;

  return { win, calls };
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

test('releases its observer and both timers exactly once when it resolves', async () => {
  const dom = new JSDOM('<div id="here"></div>');
  const { win, calls } = instrument(dom.window);
  await waitFor(() => dom.window.document.getElementById('here'), {
    root: dom.window.document, win,
  });
  assert.equal(calls.intervalsSet, 1);
  assert.equal(calls.intervalsCleared, 1, 'poll interval was never cleared');
  assert.equal(calls.timeoutsSet, 1);
  assert.equal(calls.timeoutsCleared, 1, 'timeout timer was never cleared');
  assert.equal(calls.disconnects, 1, 'MutationObserver was never disconnected');
});

test('releases its observer and both timers exactly once when it times out', async () => {
  const dom = new JSDOM('<div></div>');
  const { win, calls } = instrument(dom.window);
  await assert.rejects(
    () => waitFor(() => null, { timeout: 60, root: dom.window.document, win }),
    /timed out/i,
  );
  assert.equal(calls.intervalsSet, 1);
  assert.equal(calls.intervalsCleared, 1, 'poll interval was never cleared');
  assert.equal(calls.timeoutsSet, 1);
  assert.equal(calls.timeoutsCleared, 1, 'timeout timer was never cleared');
  assert.equal(calls.disconnects, 1, 'MutationObserver was never disconnected');
});
