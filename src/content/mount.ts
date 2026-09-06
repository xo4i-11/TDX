// Entry point for the isolated-world content script: decides whether this frame is a TDX ticket form and, if so, mounts the panel into it.
/**
 * Runs in EVERY frame, because the TDX ticket form lives inside a nested
 * iframe and a top-frame-only script would see no form controls at all.
 * `isTicketForm` itself is one cheap `querySelector`, but the real entry
 * point (the auto-run at the bottom of this file) always calls it in `wait`
 * mode, so a frame that never becomes a ticket form pays for that over up to
 * 8 seconds: a whole-document `MutationObserver` (childList + subtree +
 * attributes + characterData, see wait.ts) plus a 120ms poll, not a single
 * cheap check. That cost buys real coverage — TDX renders the ticket form's
 * markup after its own scripts run, so a frame with no form yet is often
 * about to become the ticket frame a moment later (this is exactly what "in
 * wait mode it mounts once the form appears" pins down). Both the observer
 * and the timers are torn down on every exit path (wait.ts's own cleanup()),
 * so this is a real cost, not a leak.
 */

import { createPanel, type PanelHandle } from '../ui/panel.ts';
import { createStores } from '../data/stores.ts';
import { createBridgeClient } from '../adapters/richtext.ts';
import { waitFor } from '../adapters/wait.ts';
import type { Bridge, Stores } from '../types.ts';

export function isTicketForm(doc: Document): boolean {
  // Checks every <form> on the page, not just the first one: a TDX page can
  // render a search or filter form ahead of the ticket form in document
  // order, and a form-then-marker check scoped to doc.querySelector('form')
  // would silently miss the real one.
  return Boolean(doc.querySelector('form [data-fieldtype], form [data-fieldid]'));
}

export interface MountDeps {
  stores?: Stores;
  bridge?: Bridge;
  /** Poll/observe for the form to appear instead of testing once and giving up. */
  wait?: boolean;
  timeout?: number;
}

export async function mountIfTicketForm(doc: Document, { stores, bridge, wait = false, timeout = 8000 }: MountDeps = {}): Promise<PanelHandle | null> {
  if (wait) {
    // TDX renders the form after its own scripts run, so a frame can be a
    // ticket frame a moment before it looks like one. waitFor rather than a
    // sleep: the desk network is sometimes fast and sometimes not.
    try {
      await waitFor(() => isTicketForm(doc), { timeout, root: doc, win: doc.defaultView ?? undefined });
    } catch {
      // "The panel didn't appear" is the single most likely real-browser
      // failure, and console.error's only firing point (below) is a *thrown*
      // error — the one case that does not happen here. console.info, not
      // .error: giving up is the routine, expected outcome for the vast
      // majority of the all_frames:true frames this runs in, not a bug.
      console.info(`[TDX Autofill] gave up waiting for a ticket form after ${timeout}ms (${doc.defaultView?.location.href ?? 'no URL'})`);
      return null; // not a ticket frame; every other frame lands here
    }
  } else if (!isTicketForm(doc)) {
    return null;
  }

  if (doc.getElementById('tdx-autofill-host')) return null; // already mounted

  return createPanel({
    doc,
    stores: stores ?? createStores(),
    // No defaultView (a detached document) means no page world to bridge
    // into; fillRichText treats a missing bridge as "skip straight to the
    // iframe/textarea fallback" rather than this file needing a global window.
    bridge: bridge ?? (doc.defaultView ? createBridgeClient(doc.defaultView) : undefined),
  });
}

// Auto-run only when this module is loaded as a real content script.
// `typeof document` alone is enough to keep importing this module for tests
// inert — `document` is never referenced directly, only checked, so this
// never throws under Node where no such global exists, and nothing in
// test/ ever assigns globalThis.document. (An earlier version of this file
// also checked for chrome.storage.local; that check was redundant since
// document exists precisely when this is running as the real extension's
// content script, where chrome.storage.local always exists too.)
if (typeof document !== 'undefined') {
  mountIfTicketForm(document, { wait: true }).catch((error: unknown) => {
    console.error('[TDX Autofill] failed to mount:', error);
  });
}
