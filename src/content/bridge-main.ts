// Runs inside the page's own JavaScript world so it can reach window.CKEDITOR, which the extension's isolated-world content script cannot see at all.
/**
 * A content script's "isolated world" shares the DOM with the page but gets a
 * brand new global object, so `window.CKEDITOR` is undefined there even
 * though the real editor sits in the very same document. This file is
 * injected into the MAIN world instead (see manifest.json) purely to close
 * that one gap: the isolated-world rich-text adapter posts a message asking
 * for a named CKEditor instance's data to be replaced, and this is the only
 * code that has a `window` with CKEDITOR actually on it.
 *
 * A postMessage listener living in the page's own world is a trust boundary —
 * any other script on this origin can also post to it — so this file does
 * exactly one operation, never reads arbitrary page state back out, and never
 * builds code or a function from the message it receives. Every field of an
 * incoming message is checked before anything happens with it.
 */

import { BRIDGE_CHANNEL } from './bridge-channel.ts';

export { BRIDGE_CHANNEL };

interface SetEditorDataRequest {
  id: number;
  key: string;
  html: string;
}

/** Narrows an untrusted postMessage payload down to a well-formed request for this channel. Anything else is not ours to act on. */
function asRequest(data: unknown): SetEditorDataRequest | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.channel !== BRIDGE_CHANNEL || msg.direction !== 'request') return null;
  if (msg.op !== 'setEditorData') return null;
  if (typeof msg.id !== 'number' || typeof msg.key !== 'string' || typeof msg.html !== 'string') return null;
  return { id: msg.id, key: msg.key, html: msg.html };
}

interface CKEditorInstance {
  setData(html: string): void;
  getData(): string;
}

/**
 * Just the `window` surface this file touches — narrow on purpose so a test
 * can hand it a plain fake object instead of a real browser window.
 */
interface BridgeMainWindow {
  location: { origin: string };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
  CKEDITOR?: { instances?: Record<string, CKEditorInstance | undefined> };
}

function setEditorData(win: BridgeMainWindow, key: string, html: string): { ok: boolean; detail: string } {
  const instance = win.CKEDITOR?.instances?.[key];
  if (!instance) return { ok: false, detail: `no CKEDITOR instance for "${key}"` };

  try {
    // setData updates the editor, its iframe body, and the backing textarea
    // in one call, which is why it beats touching the iframe DOM directly.
    instance.setData(html);
    const ok = instance.getData().includes(firstWords(html));
    return { ok, detail: ok ? 'CKEditor instance' : 'CKEditor accepted setData but did not retain the content' };
  } catch (error) {
    return { ok: false, detail: `CKEditor threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function firstWords(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim().slice(0, 24);
}

/**
 * The trust-boundary check, pulled out of the listener itself so a test can
 * drive it with a fabricated event instead of a real postMessage round trip
 * (which real browsers deliver correctly but jsdom does not, for same-window
 * messaging).
 */
export function handleBridgeMessage(win: BridgeMainWindow, event: { source: unknown; origin: string; data: unknown }): void {
  // Same-window, same-origin only: a hostile frame or a different origin has
  // no business asking this page to change its own editor content.
  if (event.source !== win || event.origin !== win.location.origin) return;

  const request = asRequest(event.data);
  if (!request) return;

  const { ok, detail } = setEditorData(win, request.key, request.html);
  win.postMessage(
    { channel: BRIDGE_CHANNEL, direction: 'response', id: request.id, ok, detail },
    win.location.origin,
  );
}

/** Wires the handler to a window. A function, not a bare module-level side effect, so importing this file for a test does not require a global `window` to exist. */
export function installBridge(win: BridgeMainWindow): void {
  win.addEventListener('message', (event: MessageEvent) => { handleBridgeMessage(win, event); });
}

// The real entry point: esbuild bundles this file as dist/bridge.js, which
// only ever runs inside a real page (see manifest.json's "world": "MAIN"),
// so `window` exists there. Guarded so importing this module under Node (no
// global `window`) — as the test file does — never throws.
if (typeof window !== 'undefined') {
  installBridge(window);
}
