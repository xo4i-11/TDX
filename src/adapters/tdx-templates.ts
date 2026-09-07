// Opens TDX's own comment-template menu and clicks one entry, then waits for the editor to receive it.
/**
 * TDX renders its comment templates as a Bootstrap dropdown of
 * `a.js-template[data-template-id]` links grouped into submenus (ACO, ALL,
 * UBIT HC, …). Clicking one makes TDX fetch the body and drop it into
 * CKEditor.
 *
 * This is the one place the extension drives someone else's AJAX, which the
 * lookup adapter exists to avoid — so it is written to fail visibly and
 * harmlessly: it finds the link by *name*, never by a hardcoded id, reports
 * "not found" rather than clicking something else, and waits for the editor
 * to actually change instead of assuming the click worked.
 */

import { waitFor } from './wait.ts';
import { isBlankHtml } from '../data/resolved.ts';

/** How long to give TDX's fetch before calling it a miss. Its own menu, its own network. */
const LOAD_TIMEOUT_MS = 6000;

/**
 * Finds one template link by its visible name, preferring the named group.
 *
 * Names are matched exactly (trimmed, case-insensitive) because "Ticket
 * Resolved", "Ticket Resolved - No Response" and "@Ticket Resolved" all exist
 * side by side in this menu, and a substring match would pick whichever came
 * first in the DOM.
 */
export function findTemplateLink(doc: Document, name: string, group?: string): HTMLAnchorElement | null {
  const wanted = name.trim().toLowerCase();
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a.js-template')]
    .filter((link) => (link.textContent ?? '').trim().toLowerCase() === wanted);
  if (!links.length) return null;
  if (!group) return links[0] ?? null;

  const wantedGroup = group.trim().toLowerCase();
  const inGroup = links.find((link) => {
    // The submenu's own label is the anchor immediately before the <ul> this
    // link sits in — TDX's markup is <li class="dropdown-submenu"><a>ALL</a><ul>…
    const submenu = link.closest('li.dropdown-submenu');
    const label = submenu?.querySelector('a')?.textContent?.trim().toLowerCase();
    return label === wantedGroup;
  });
  // Falling back to the first same-named link is deliberate: a renamed group
  // should not silently stop the flow when the template itself is still there.
  return inGroup ?? links[0] ?? null;
}

/**
 * Opens every dropdown between the page and this link, outermost first, then
 * leaves them open for the click that follows.
 *
 * Clicking the buried link on its own does nothing: TDX's handler runs through
 * the opened menu, and a submenu that was never opened never gets its entries
 * wired. The `open` class and aria-expanded are set directly as well as
 * clicked, so the menu still opens if Bootstrap's own handler is bound
 * differently than this expects — belt and braces on someone else's widget.
 */
function openMenuTo(link: HTMLAnchorElement): void {
  const view = link.ownerDocument.defaultView;
  if (!view) return;

  const toggles: HTMLAnchorElement[] = [];
  let node: Element | null = link.parentElement;
  while (node) {
    const container = node.closest('.dropdown, li.dropdown-submenu');
    if (!container) break;
    const toggle = container.querySelector<HTMLAnchorElement>(':scope > a[data-toggle="dropdown"], :scope > a.dropdown-toggle');
    if (toggle) toggles.push(toggle);
    node = container.parentElement;
  }

  // Outermost first: a submenu cannot be opened before the menu holding it.
  for (const toggle of toggles.reverse()) {
    const container = toggle.closest('.dropdown, li.dropdown-submenu');
    container?.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, view }));
  }
}

export interface ApplyTemplateResult {
  ok: boolean;
  detail: string;
}

/**
 * Clicks the link and waits until `readBody` reports content that is both
 * non-empty and different from what was there before.
 *
 * `readBody` is injected rather than imported so this file stays ignorant of
 * how a rich-text control is read — and so a test can drive it without a
 * CKEditor.
 */
export async function applyTemplate(
  link: HTMLAnchorElement,
  readBody: () => string,
  { timeout = LOAD_TIMEOUT_MS }: { timeout?: number } = {},
): Promise<ApplyTemplateResult> {
  const before = readBody();
  const doc = link.ownerDocument;
  const view = doc.defaultView;
  if (!view) return { ok: false, detail: 'the template menu has no window to dispatch a click in' };

  // The menu has to be physically open first: clicking the buried link alone
  // does nothing, which is how this shipped broken the first time.
  openMenuTo(link);
  link.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, view }));

  try {
    await waitFor(() => {
      const now = readBody();
      // Blank rather than empty: CKEditor seeds a placeholder paragraph, so
      // "the body changed to <p><br></p>" is not the template arriving.
      return !isBlankHtml(now) && now !== before;
    }, { timeout, root: doc, win: view });
  } catch {
    return { ok: false, detail: `the comment editor did not change within ${timeout}ms of clicking the template` };
  }
  return { ok: true, detail: 'loaded from the TDX template menu' };
}
