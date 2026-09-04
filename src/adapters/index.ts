// Looks at a harvested control's shape and routes the fill/read call to the one adapter that knows how to handle that shape.
/**
 * This is the boundary the "adapters hold no field logic" rule protects: the
 * dispatcher sees a shape and a value, never a field name. Task 14's fill
 * policy is the only caller — it decides *what* to write; this decides
 * *which adapter* writes it.
 */

import { fillText, fillSelect, readValue } from './text.ts';
import { fillLookup, readLookup } from './lookup.ts';
import { fillRichText, readRichText, type FillRichTextOptions } from './richtext.ts';
import type { AdapterResult, Captured, Control } from '../types.ts';

/** Everything a fill needs beyond the control and the value. Only richtext uses it (the bridge to CKEditor). */
export type ApplyContext = FillRichTextOptions;

export async function applyValue(control: Control, value: unknown, ctx: ApplyContext = {}): Promise<AdapterResult> {
  switch (control.shape) {
    case 'text':
      return fillText(control, String(value));
    case 'select':
      return fillSelect(control, String(value));
    case 'lookup':
      return fillLookup(control, value as Partial<Captured> | null | undefined);
    case 'richtext':
      return fillRichText(control, String(value), ctx);
    case 'select2':
      // ponytail: detection only. Nothing in the fill set is a select2
      // control, so shipping an untested write path would be surface with
      // no purpose. Add fillSelect2 in adapters/ when a real field needs it.
      return { status: 'skipped', detail: 'select2 controls are detected but not written in this version' };
    default:
      return { status: 'skipped', detail: `no adapter for control shape "${String(control.shape)}"` };
  }
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
