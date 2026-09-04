// Writes values into plain inputs, textareas, and native selects, verifying every write by reading it back.
/**
 * Knows nothing about which field it is filling. Field identity, fixed values,
 * and preserve-versus-overwrite all live in fill policy (Task 14); this file
 * only knows how to put a string into a control and prove it stuck.
 */

import type { AdapterResult, Control } from '../types.ts';

/** The DOM elements this file knows how to write into. */
type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * DO NOT SIMPLIFY THIS TO `el.value = value`.
 *
 * Kendo and other widget libraries shadow the `value` property on the element
 * instance. Assigning through the instance updates the visible text but leaves
 * the widget's internal model untouched, and the ASP.NET postback then submits
 * an empty field with no error anywhere. Going through the prototype's setter
 * reaches the real DOM value that the form actually serialises.
 */
export function setNativeValue(el: ValueElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  // The fallback walks the element's own window, not a bare global: the TDX
  // form renders inside an iframe with its own realm, so the top frame's
  // HTMLInputElement class is a different object entirely.
  const fallback = el.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    ?? (fallback && Object.getOwnPropertyDescriptor(fallback, 'value'));
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

function fireTextEvents(el: HTMLInputElement | HTMLTextAreaElement): void {
  const view = el.ownerDocument.defaultView ?? window;
  // Order matters: widgets bind to different ones, and blur is what commits
  // several Kendo inputs.
  for (const type of ['input', 'change', 'blur']) {
    el.dispatchEvent(new view.Event(type, { bubbles: true }));
  }
}

export function fillText(control: Control, value: string): AdapterResult {
  const el = control.el as HTMLInputElement | HTMLTextAreaElement;
  setNativeValue(el, value);
  fireTextEvents(el);

  const actual = el.value;
  if (actual !== value) {
    return {
      status: 'failed',
      detail: `wrote ${JSON.stringify(value)}, read back ${JSON.stringify(actual)}`,
    };
  }
  return { status: 'filled', detail: '' };
}

export function fillSelect(control: Control, value: string): AdapterResult {
  const el = control.el as HTMLSelectElement;
  const wanted = value.toLowerCase();
  const options = [...el.options];

  // ponytail: exact match, then prefix match. No fuzzy/Levenshtein matching —
  // add it if a real TDX option list ever needs more than a typo of slack.
  const match = options.find((o) => (o.textContent ?? '').trim().toLowerCase() === wanted)
    ?? options.find((o) => (o.textContent ?? '').trim().toLowerCase().startsWith(wanted));

  if (!match) {
    const known = options.map((o) => (o.textContent ?? '').trim()).filter(Boolean).join(', ');
    return {
      status: 'failed',
      detail: `no option matching ${JSON.stringify(value)} (have: ${known})`,
    };
  }

  setNativeValue(el, match.value);
  const view = el.ownerDocument.defaultView ?? window;
  el.dispatchEvent(new view.Event('change', { bubbles: true }));

  const selectedText = (el.options[el.selectedIndex]?.textContent ?? '').trim();
  const wantedText = (match.textContent ?? '').trim();
  if (selectedText !== wantedText) {
    return {
      status: 'failed',
      detail: `selected ${JSON.stringify(selectedText)}, expected ${JSON.stringify(wantedText)}`,
    };
  }
  return { status: 'filled', detail: wantedText };
}

/** Current human-readable value, used by fill policy to decide preserve versus overwrite. */
export function readValue(control: Control): string {
  const el = control.el;
  if (el.tagName.toLowerCase() === 'select') {
    const select = el as HTMLSelectElement;
    return (select.options[select.selectedIndex]?.textContent ?? '').trim();
  }
  return (el as HTMLInputElement | HTMLTextAreaElement).value ?? '';
}
