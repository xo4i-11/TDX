// Fills a TDX type-ahead lookup by replaying a previously captured {id, text} pair instead of driving the real autocomplete.
/**
 * WHY NOT DRIVE THE AUTOCOMPLETE: typing a query means waiting on AJAX,
 * disambiguating multiple result rows, and dispatching mousedown before click
 * because several Kendo widgets commit on mousedown. Worse, every lookup on
 * the page shares one suggestion container, so two fills in flight click each
 * other's results. And this project makes zero network requests, so driving
 * the server-backed search isn't even an option. TDX lookup ids are stable
 * per instance, so capturing the {id, text} pair once and replaying it
 * removes that entire class of failure.
 *
 * A lookup is three elements: a visible text input, a hidden input carrying
 * the real id, and a reset input. Writing only the visible input leaves the
 * hidden id empty and the ticket saves with no service and no error.
 */

import { setNativeValue } from './text.ts';
import type { AdapterResult, Captured, Control } from '../types.ts';

function fire(el: HTMLInputElement, type: string): void {
  const view = el.ownerDocument.defaultView ?? window;
  el.dispatchEvent(new view.Event(type, { bubbles: true }));
}

export function fillLookup(control: Control, captured: Partial<Captured> | null | undefined): AdapterResult {
  const id = captured?.id;
  const text = captured?.text;
  if (!id || !text) {
    return { status: 'failed', detail: 'incomplete capture: need both id and text, refusing to write a partial value' };
  }

  const parts = control.lookup;
  if (!parts) {
    return { status: 'failed', detail: 'control has no lookup parts' };
  }
  const { hidden, input, reset } = parts;

  if (reset) setNativeValue(reset, id);
  setNativeValue(hidden, id);
  setNativeValue(input, text);

  fire(input, 'input');
  fire(input, 'change');
  fire(hidden, 'change');
  fire(input, 'blur');

  if (hidden.value !== id) {
    return { status: 'failed', detail: `wrote id ${id}, read back ${JSON.stringify(hidden.value)}` };
  }
  if (input.value !== text) {
    return { status: 'failed', detail: `display text mismatch: wrote ${JSON.stringify(text)}, read back ${JSON.stringify(input.value)}` };
  }
  return { status: 'filled', detail: `${text} (id ${id})` };
}

/** Reads a lookup's current selection so it can be stored on a template. */
export function captureLookup(control: Control): Captured | null {
  const parts = control.lookup;
  if (!parts) return null;

  const id = parts.hidden.value.trim();
  if (!id) return null;

  const text = parts.input.value.trim() || defaultCaption(parts.hidden);
  if (!text) return null;
  return { id, text };
}

/** Current visible text, used by fill policy to decide preserve versus overwrite. */
export function readLookup(control: Control): string {
  const parts = control.lookup;
  if (!parts) return '';
  return parts.input.value.trim() || defaultCaption(parts.hidden) || '';
}

/**
 * When TDX prefills a lookup from the launch URL it populates the hidden id
 * and a data-default JSON blob, but leaves the visible input empty until its
 * widget initialises. Reading the blob makes capture work on a freshly
 * loaded form, before any widget has run.
 */
function defaultCaption(hidden: HTMLInputElement): string {
  const raw = hidden.getAttribute('data-default');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Array<{ caption?: string }> | undefined;
    return parsed?.[0]?.caption ?? '';
  } catch {
    return '';
  }
}
