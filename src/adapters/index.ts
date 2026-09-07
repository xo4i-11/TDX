// Looks at a harvested control's shape and routes the fill/read call to the one adapter that knows how to handle that shape.
/**
 * This is the boundary the "adapters hold no field logic" rule protects: the
 * dispatcher sees a shape and a value, never a field name. The fill policy
 * (src/fill/policy.ts) is the only caller — it decides *what* to write; this
 * decides *which adapter* writes it.
 *
 * It takes an `unknown` value because the policy's two value kinds (a string
 * and a captured {id,text} pair) are chosen per field, while this file routes
 * per control shape. Those can disagree on a form the engine has not seen, so
 * each arm narrows the value itself and reports a mismatch rather than
 * stringifying a captured pair into "[object Object]" and calling it filled.
 */

import { fillText, fillSelect, readValue } from './text.ts';
import { fillLookup, readLookup } from './lookup.ts';
import { fillRichText, readRichText, type FillRichTextOptions } from './richtext.ts';
import type { AdapterResult, Control } from '../types.ts';

/** Everything a fill needs beyond the control and the value: the CKEditor bridge, plus a way back to a control an earlier write detached. */
export type ApplyContext = FillRichTextOptions & {
  /** Re-resolves one field against the live DOM. executeFill calls it when a control left the page mid-run. */
  refind?: (fieldKey: string) => Promise<Control | null>;
};

export async function applyValue(control: Control, value: unknown, ctx: ApplyContext = {}): Promise<AdapterResult> {
  switch (control.shape) {
    case 'text':
    case 'select':
    case 'richtext': {
      if (typeof value !== 'string') return mismatch(control.shape, 'a string', value);
      if (control.shape === 'text') return fillText(control, value);
      if (control.shape === 'select') return fillSelect(control, value);
      return fillRichText(control, value, ctx);
    }
    case 'lookup': {
      if (value === null || value === undefined) return fillLookup(control, value);
      if (typeof value !== 'object') return mismatch('lookup', 'an {id,text} pair', value);
      // Read field by field so the narrowing is real rather than asserted: an
      // object that isn't a Captured reaches fillLookup as a partial, which
      // already refuses to write half a lookup.
      const id = 'id' in value && typeof value.id === 'string' ? value.id : undefined;
      const text = 'text' in value && typeof value.text === 'string' ? value.text : undefined;
      return fillLookup(control, { id, text });
    }
    case 'select2':
      // ponytail: detection only. Nothing in the fill set is a select2
      // control, so shipping an untested write path would be surface with
      // no purpose. Add fillSelect2 in adapters/ when a real field needs it.
      return { status: 'skipped', detail: 'select2 controls are detected but not written in this version' };
    default:
      return { status: 'skipped', detail: `no adapter for control shape "${String(control.shape)}"` };
  }
}

/** Says which value kind a control shape needed and what it got, instead of writing nonsense. */
function mismatch(shape: string, expected: string, value: unknown): AdapterResult {
  return { status: 'failed', detail: `a ${shape} control needs ${expected}, got ${typeof value}` };
}

export function currentValue(control: Control): string {
  switch (control.shape) {
    case 'lookup':
      return readLookup(control);
    case 'richtext':
      return readRichText(control);
    case 'text':
    case 'select':
    case 'select2':
      return readValue(control);
    default:
      return '';
  }
}
