// Fills a rich-text control, which TDX renders with CKEditor instead of a plain textarea, and provides the isolated-world half of the page-world bridge that reaches it.
/**
 * A CKEditor-backed control can be in one of three states depending on how
 * far the widget got initialising by the time this runs: a live CKEditor
 * instance (reached only through the page-world bridge, since an
 * isolated-world content script cannot see window.CKEDITOR), a classic-mode
 * iframe body with no bridge answer, or — before the widget has replaced
 * anything — the bare textarea. Each path verifies its own result: reporting
 * "filled" for a value that did not land would put an empty field in the
 * queue with nothing to notice it by. This file knows nothing about which
 * canonical field it serves — that lives in fill policy (Task 14).
 */

import { setNativeValue } from './text.ts';
import type { AdapterResult, Bridge, Control } from '../types.ts';

// Keep this in sync with src/content/bridge-main.ts's own BRIDGE_CHANNEL —
// the two files can't share an import (they're bundled as separate MV3
// worlds), so the literal is duplicated deliberately rather than wired
// together for a single never-changing string.
export const BRIDGE_CHANNEL = 'tdxa';

const DEFAULT_BRIDGE_TIMEOUT = 3000;

interface BridgeResponse {
  id: number;
  ok: boolean;
  detail: string;
}

/** Narrows an untrusted postMessage payload down to a reply for this channel. Anything else is not ours. */
function asBridgeResponse(data: unknown): BridgeResponse | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.channel !== BRIDGE_CHANNEL || msg.direction !== 'response') return null;
  if (typeof msg.id !== 'number') return null;
  return { id: msg.id, ok: msg.ok === true, detail: typeof msg.detail === 'string' ? msg.detail : '' };
}

/**
 * Just the `window` surface this file needs — narrow on purpose (the same
 * trick as wait.ts's WaitWindow) so a test can hand it a plain fake object
 * instead of a real browser window.
 */
interface BridgeClientWindow {
  location: { origin: string };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
  setTimeout: Window['setTimeout'];
  clearTimeout: Window['clearTimeout'];
}

/**
 * Isolated-world side of the bridge: posts a request into the page world
 * (where src/content/bridge-main.ts is listening) and waits for the matching
 * reply. Every incoming message is checked for same-window origin and a
 * matching request id before it is trusted — a postMessage listener is a
 * trust boundary in both directions.
 */
export function createBridgeClient(win: BridgeClientWindow = window): Bridge {
  let nextId = 1;

  return {
    setEditorData(instanceKey: string, html: string) {
      const id = nextId++;

      return new Promise((resolve) => {
        let settled = false;

        const finish = (result: { ok: boolean; detail: string }): void => {
          if (settled) return;
          settled = true;
          win.clearTimeout(timer);
          win.removeEventListener('message', onMessage);
          resolve(result);
        };

        function onMessage(event: MessageEvent): void {
          // Same-window, same-origin only, and it must answer this exact
          // request — an unrelated in-flight request's reply is not ours.
          if (event.source !== win || event.origin !== win.location.origin) return;
          const reply = asBridgeResponse(event.data);
          if (!reply || reply.id !== id) return;
          finish({ ok: reply.ok, detail: reply.detail });
        }

        // This is a failure deadline on a reply that may never come, not a
        // sleep waiting for a DOM condition — the one shape waitFor's own
        // no-fixed-sleep exception covers.
        const timer = win.setTimeout(() => {
          finish({ ok: false, detail: `bridge did not answer within ${DEFAULT_BRIDGE_TIMEOUT}ms` });
        }, DEFAULT_BRIDGE_TIMEOUT);

        win.addEventListener('message', onMessage);
        win.postMessage(
          { channel: BRIDGE_CHANNEL, direction: 'request', id, op: 'setEditorData', key: instanceKey, html },
          win.location.origin,
        );
      });
    },
  };
}

export interface FillRichTextOptions {
  bridge?: Bridge;
  bridgeTimeout?: number;
}

export async function fillRichText(control: Control, html: string, options: FillRichTextOptions = {}): Promise<AdapterResult> {
  const { bridge, bridgeTimeout = DEFAULT_BRIDGE_TIMEOUT } = options;
  const attempts: string[] = [];

  if (bridge && control.richtext) {
    const answer = await withTimeout(
      bridge.setEditorData(control.richtext.instanceKey, html),
      bridgeTimeout,
      { ok: false, detail: 'bridge did not answer' },
    );
    if (answer.ok) return { status: 'filled', detail: answer.detail || 'CKEditor instance' };
    attempts.push(`CKEditor: ${answer.detail}`);
  }

  const iframeResult = fillViaIframe(control, html);
  if (iframeResult) {
    if (iframeResult.ok) return { status: 'filled', detail: 'iframe editor body' };
    attempts.push(`iframe: ${iframeResult.detail}`);
  }

  const editableResult = fillViaContentEditable(control, html);
  if (editableResult) {
    if (editableResult.ok) return { status: 'filled', detail: 'contenteditable element' };
    attempts.push(`contenteditable: ${editableResult.detail}`);
  }

  const textareaResult = fillViaTextarea(control, html);
  if (textareaResult) {
    if (textareaResult.ok) return { status: 'filled', detail: 'plain textarea' };
    attempts.push(`textarea: ${textareaResult.detail}`);
  }

  return { status: 'failed', detail: `no path verified — ${attempts.join('; ') || 'no writable target found'}` };
}

/** Current plain-text content, used by fill policy to decide preserve versus overwrite. */
export function readRichText(control: Control): string {
  const body = sameOriginBody(editorIframe(control));
  if (body) return (body.textContent ?? '').trim();

  const editable = contentEditableIn(control);
  if (editable) return (editable.textContent ?? '').trim();

  const textarea = plainTextarea(control);
  return stripTags(textarea?.value ?? '');
}

type StepResult = { ok: boolean; detail: string };

function fillViaIframe(control: Control, html: string): StepResult | null {
  const body = sameOriginBody(editorIframe(control));
  if (!body) return null;

  body.innerHTML = html;
  // The iframe is only what the technician sees; the textarea is what posts
  // back. Writing one without the other submits an empty value for this field.
  syncTextarea(control, html);
  const ok = body.innerHTML.includes(firstWords(html)) && (control.richtext?.textarea.value ?? '') === html;
  return { ok, detail: ok ? '' : 'wrote iframe body but read-back did not match' };
}

function fillViaContentEditable(control: Control, html: string): StepResult | null {
  const editable = contentEditableIn(control);
  if (!editable) return null;

  editable.innerHTML = html;
  syncTextarea(control, html);
  const ok = editable.innerHTML.includes(firstWords(html));
  return { ok, detail: ok ? '' : 'wrote contenteditable but read-back did not match' };
}

function fillViaTextarea(control: Control, html: string): StepResult | null {
  const textarea = plainTextarea(control);
  if (!textarea) return null;

  setNativeValue(textarea, html);
  const view = textarea.ownerDocument.defaultView ?? window;
  textarea.dispatchEvent(new view.Event('change', { bubbles: true }));

  const ok = textarea.value === html;
  return { ok, detail: ok ? '' : `wrote ${html.length} chars, read back ${textarea.value.length}` };
}

function syncTextarea(control: Control, html: string): void {
  const textarea = control.richtext?.textarea;
  if (textarea) setNativeValue(textarea, html);
}

function anchorElement(control: Control): Element {
  return control.richtext?.textarea ?? control.el;
}

function editorIframe(control: Control): HTMLIFrameElement | null {
  const group = anchorElement(control).closest('.form-group');
  return group?.querySelector<HTMLIFrameElement>('iframe') ?? null;
}

function contentEditableIn(control: Control): HTMLElement | null {
  const group = anchorElement(control).closest('.form-group');
  const nested = group?.querySelector<HTMLElement>('[contenteditable="true"]');
  if (nested) return nested;
  // The harvested control itself can be the editable element (no CKEditor
  // textarea behind it at all — see harvest.ts's bare-contenteditable case).
  return control.el.getAttribute('contenteditable') === 'true' ? (control.el as HTMLElement) : null;
}

function plainTextarea(control: Control): HTMLTextAreaElement | null {
  if (control.richtext) return control.richtext.textarea;
  return control.el.tagName.toLowerCase() === 'textarea' ? (control.el as HTMLTextAreaElement) : null;
}

function sameOriginBody(iframe: HTMLIFrameElement | null): HTMLElement | null {
  if (!iframe) return null;
  try {
    return iframe.contentDocument?.body ?? null;
  } catch {
    return null; // cross-origin; nothing to do here and nothing to report as an error
  }
}

function firstWords(html: string): string {
  return stripTags(html).slice(0, 24);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Not a bare Promise.race: race's loser keeps its timer alive for the full
// duration even after the winner settles, which would hold the event loop
// open for `ms` on every single fill. Clearing it on whichever side wins
// matches the cleanup discipline waitFor's own timers already follow.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
