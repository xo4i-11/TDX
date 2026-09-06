// Entry point for the isolated-world content script: decides whether this frame is a TDX ticket form and, if so, mounts the panel into it.
/**
 * Runs in EVERY frame, because the TDX ticket form lives inside a nested
 * iframe and a top-frame-only script would see no form controls at all. Each
 * frame self-tests and all but one exit immediately, so "all_frames" costs a
 * single querySelector per frame.
 */

import { createPanel, type PanelHandle } from '../ui/panel.ts';
import { createStores } from '../data/stores.ts';
import { createBridgeClient } from '../adapters/richtext.ts';
import { waitFor } from '../adapters/wait.ts';
import type { Bridge, Stores } from '../types.ts';

export function isTicketForm(doc: Document): boolean {
  const form = doc.querySelector('form');
  if (!form) return false;
  // TDX marks every field wrapper. A form without those markers is not a TDX
  // ticket form — it is a search box, a login, or someone else's page.
  return Boolean(form.querySelector('[data-fieldtype], [data-fieldid]'));
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

// globalThis has no ambient `chrome` type without @types/chrome (same
// narrow-cast idiom src/data/stores.ts uses for the same untyped global).
function hasChromeStorage(): boolean {
  const g = globalThis as { chrome?: { storage?: { local?: unknown } } };
  return typeof g.chrome?.storage?.local !== 'undefined';
}

// Auto-run only in a real extension context; importing this module for tests
// must stay inert (`typeof document` is checked, never `document` referenced
// directly, so this never throws under Node where no such global exists).
if (hasChromeStorage() && typeof document !== 'undefined') {
  mountIfTicketForm(document, { wait: true }).catch((error: unknown) => {
    console.error('[TDX Autofill] failed to mount:', error);
  });
}
