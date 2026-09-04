// Waits for a DOM condition to become true, without ever guessing at a fixed sleep duration.
/**
 * The project's only sanctioned way to wait for something in the page.
 *
 * A fixed setTimeout is never correct here: the help desk network is sometimes
 * fast and sometimes not, and a sleep long enough to be safe is long enough to
 * be annoying on every single fill. MutationObserver catches the common case
 * instantly; the poll catches changes that mutate no nodes, such as a widget
 * flipping a property on an element that is already present.
 */

const POLL_MS = 120;
const DEFAULT_TIMEOUT_MS = 5000;

/** Values ordinary JS treats as "not yet" — what the predicate is allowed to return meaning no. */
type Falsy = null | undefined | false | 0 | '';

/**
 * Just the timer/observer surface waitFor needs. The DOM lib's own `Window`
 * type is unusable here: MutationObserver isn't a member of `Window` at all
 * (it's a bare global), and jsdom's `DOMWindow` type doesn't structurally
 * satisfy `Window` either. A narrow interface sidesteps both.
 */
interface WaitWindow {
  MutationObserver: typeof MutationObserver;
  // Indexed off the Window interface, not the bare global: @types/node's
  // ambient setInterval/setTimeout (which return NodeJS.Timeout) merge into
  // the same global scope as the DOM lib's (which return number), and `typeof
  // setInterval` would pick up that clash.
  setInterval: Window['setInterval'];
  clearInterval: Window['clearInterval'];
  setTimeout: Window['setTimeout'];
  clearTimeout: Window['clearTimeout'];
}

export interface WaitForOptions {
  timeout?: number;
  /** Defaults to the global document — pass the iframe's own document when waiting inside one. */
  root?: Document;
  /** Defaults to root's view — pass the iframe's own window so timers and MutationObserver live there too. */
  win?: WaitWindow;
}

export function waitFor<T>(
  predicate: () => T,
  { timeout = DEFAULT_TIMEOUT_MS, root, win }: WaitForOptions = {},
): Promise<Exclude<T, Falsy>> {
  const doc = root ?? document;
  const view: WaitWindow = win ?? doc.defaultView ?? window;

  return new Promise((resolvePromise, reject) => {
    let settled = false;

    const check = (): boolean => {
      if (settled) return false;
      let value: T;
      try {
        value = predicate();
      } catch {
        return false; // a predicate that throws mid-render is just "not yet"
      }
      if (!value) return false;
      settled = true;
      cleanup();
      resolvePromise(value as Exclude<T, Falsy>);
      return true;
    };

    const observer = new view.MutationObserver(check);
    const poll = view.setInterval(check, POLL_MS);
    const timer = view.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`waitFor timed out after ${timeout}ms`));
    }, timeout);

    function cleanup(): void {
      observer.disconnect();
      view.clearInterval(poll);
      view.clearTimeout(timer);
    }

    if (check()) return;
    observer.observe(doc.documentElement ?? doc, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
}
