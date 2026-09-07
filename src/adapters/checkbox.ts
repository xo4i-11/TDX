// Writes a boolean checkbox and verifies the page kept it.
/**
 * Separate from text.ts because a checkbox's value is `.checked`, not
 * `.value` — `setNativeValue` would write the string "false" into `value`,
 * leave the box checked, and report success for a write that never happened.
 * Like every adapter here, this one knows nothing about which field it serves.
 */

import type { AdapterResult, Control } from '../types.ts';

export function fillCheckbox(control: Control, value: boolean): AdapterResult {
  const el = control.el as HTMLInputElement;
  if (typeof el.checked !== 'boolean') {
    return { status: 'failed', detail: 'control is not a checkbox' };
  }

  el.checked = value;
  const view = el.ownerDocument.defaultView ?? window;
  // Not click(): that would toggle a second time. A change event is what page
  // scripts listen for, and what an unchecked private-comment box has to announce.
  el.dispatchEvent(new view.Event('change', { bubbles: true }));

  if (el.checked !== value) {
    return { status: 'failed', detail: `wrote ${value}, read back ${el.checked}` };
  }
  return { status: 'filled', detail: value ? 'checked' : 'unchecked' };
}

/** Current state, for report rows. */
export function readCheckbox(control: Control): boolean {
  return (control.el as HTMLInputElement).checked === true;
}
