// Recovers the requestor TDX already knows about, from the page itself.
/**
 * Three sources, none of which the technician has to touch: the form's URL,
 * the requestor lookup on the form, and the Requestor card TDX renders beside
 * it.
 *
 * The card is the only source of the UBITName, the email and the person
 * number — and it is usually NOT in the same document as the form. TDX renders
 * the ticket form in a nested iframe while the card sits in the page around
 * it, so a search that stops at the form's own document finds a name and a
 * GUID and reports everything else missing.
 */

import { ID_LINE, parseRequestor } from './parser.ts';
import { readLookup } from '../adapters/lookup.ts';
import type { RequestorFields, Resolution } from '../types.ts';

/** Returns only the fields it actually found, so a caller can merge it over what it already has. */
export function readRequestorFromPage(doc: Document, resolution: Resolution): Partial<RequestorFields> {
  const url = doc.defaultView?.location.href ?? '';
  const fromUrl = url.match(/RequestorUID=([0-9a-f-]{36})/i)?.[1] ?? null;

  const control = resolution.byField.get('requestor')?.control ?? null;
  const hidden = control?.lookup?.hidden ?? null;
  const personGuid = (hidden?.value || fromUrl || null)?.toLowerCase() ?? null;
  // readLookup already reads the visible caption, falling back to the
  // data-default blob TDX writes when a widget hasn't initialised yet.
  const name = control ? readLookup(control) || null : null;

  const found: Partial<RequestorFields> = {};
  for (const [key, value] of Object.entries(readCard(doc)) as [keyof RequestorFields, string | null][]) {
    if (value) found[key] = value;
  }
  if (personGuid) found.personGuid = personGuid;
  if (name) found.name = name;
  return found;
}

/** The form's own document, then the documents around it — the card usually lives in one of those. */
function documentsToSearch(doc: Document): Document[] {
  const docs = [doc];
  const view = doc.defaultView;
  if (!view) return docs;

  // Same-origin only, and never more than a few frames up: a cross-origin
  // parent throws on access, which is not an error worth reporting — it just
  // means the card is not readable from here.
  let win: Window | null = view;
  for (let hops = 0; hops < 4 && win; hops++) {
    try {
      const parent: Window | null = win.parent === win ? null : win.parent;
      if (!parent?.document) break;
      if (!docs.includes(parent.document)) docs.push(parent.document);
      win = parent;
    } catch {
      break;
    }
  }
  return docs;
}

/**
 * Reads the Requestor card: the block carrying the email, the title, and the
 * "50583450 - duynghie" ID line that is the only authoritative source of the
 * UBITName — never the email's local part, since aliases exist.
 *
 * TDX renders it as free text with no stable id or class, so this anchors on
 * that ID line rather than on markup that changes per skin, then hands the
 * surrounding block to the same parser a pasted block would go through.
 */
function readCard(doc: Document): Partial<RequestorFields> {
  for (const candidate of documentsToSearch(doc)) {
    const found = readCardIn(candidate);
    if (found) return found;
  }
  return {};
}

function readCardIn(doc: Document): Partial<RequestorFields> | null {
  if (!doc.body) return null;
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!ID_LINE.test((node.textContent ?? '').trim())) continue;
    let block = node.parentElement;
    // Climb to the block that also holds the email: the card, not the bare line.
    for (let hops = 0; hops < 5 && block?.parentElement; hops++) {
      if (block.querySelector('a[href^="mailto:"]')) break;
      block = block.parentElement;
    }
    if (block) return parseRequestor(blockLines(block)).fields;
  }
  return null;
}

/** textContent collapses the card to one line, and jsdom has no innerText — so rebuild one line per text node. */
function blockLines(el: Element): string {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const lines: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

/** Which fields are still missing, phrased for the panel's warning list. */
export function missingWarnings(fields: RequestorFields | null): string[] {
  const warnings: string[] = [];
  const checks: [keyof RequestorFields, string][] = [
    ['name', 'name'], ['email', 'email'], ['ubitName', 'UBITName'],
    ['personNumber', 'person number'], ['personGuid', 'person GUID'],
  ];
  for (const [key, label] of checks) {
    if (!fields?.[key]) warnings.push(`No ${label} found.`);
  }
  return warnings;
}
