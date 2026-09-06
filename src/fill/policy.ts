// Decides what to write into a TDX form field and whether it's safe to write it, given what's already there.
/**
 * This is the ONLY field-aware layer. Adapters below it take a control and a
 * value and know nothing about which field they serve; the resolver above it
 * maps controls to fields and knows nothing about values. Keeping the three
 * apart is what makes the engine testable against forms it has never seen.
 */

import { DICTIONARY, FILL_SET, byKey } from '../core/dictionary.ts';
import { applyValue, currentValue, type ApplyContext } from '../adapters/index.ts';
import { renderTemplate } from '../data/templates.ts';
import type {
  Captured, FieldDef, FillRow, FillStatus, RequestorFields, Resolution, Settings, Template,
} from '../types.ts';

const OUT_OF_SCOPE = 'out of fill scope — resolved and reported, never written';

export interface PlanFillArgs {
  resolution: Resolution;
  requestor: RequestorFields;
  template?: Template | null;
  service?: Captured | null;
  settings: Settings;
  now?: Date;
}

/** What renderTemplate hands back — named here so valueFor doesn't need its own copy. */
type Rendered = ReturnType<typeof renderTemplate>;

/** Either a value ready to write, or the reason it can't be written yet. Never both. */
type ValueOutcome =
  | { kind: 'value'; value: string | Captured }
  | { kind: 'blocked'; status: FillStatus; detail: string };

/**
 * Decides, for every field in the fill set, whether to write and what — plus
 * a report row for everything else the resolver recognised. Pure: reads the
 * resolution and settings it's given, touches no DOM, awaits nothing.
 */
export function planFill({
  resolution, requestor, template = null, service = null, settings, now = new Date(),
}: PlanFillArgs): FillRow[] {
  const rendered: Rendered = template
    ? renderTemplate(template, requestor, { now })
    : { summary: '', descriptionHtml: '', unknown: [] };
  const rows: FillRow[] = [];

  for (const fieldKey of FILL_SET) {
    const def = byKey(fieldKey);
    // FILL_SET is authored against DICTIONARY — both live in
    // src/core/dictionary.ts, whose tests pin them to each other — so this
    // never fires outside a broken edit to one of those two arrays.
    if (!def) continue;

    const match = resolution.byField.get(fieldKey);
    if (!match) {
      rows.push(report(def, 'skipped', 'not found on this form (unresolved)'));
      continue;
    }

    const outcome = valueFor(fieldKey, { rendered, requestor, service });
    if (outcome.kind === 'blocked') {
      rows.push({ ...report(def, outcome.status, outcome.detail), control: match.control, confidence: match.confidence });
      continue;
    }

    const existing = currentValue(match.control);
    if (existing && !settings.overwrite) {
      rows.push({
        ...report(def, 'preserved', `already set to ${JSON.stringify(truncate(existing))}; enable overwrite to replace`),
        control: match.control,
        confidence: match.confidence,
      });
      continue;
    }

    rows.push({
      fieldKey, label: def.label, action: 'write', value: outcome.value,
      status: 'pending', detail: '', control: match.control, confidence: match.confidence,
    });
  }

  // Everything else the resolver found: reported so a technician can see what
  // the engine understood, and so a bad match is visible before it matters.
  // Affiliation lands here too — it is outside the fill set, so it can only
  // ever reach a report row, never a write row.
  for (const def of DICTIONARY) {
    if (FILL_SET.includes(def.key)) continue;
    const match = resolution.byField.get(def.key);
    if (!match) continue;
    rows.push({ ...report(def, 'skipped', OUT_OF_SCOPE), control: match.control, confidence: match.confidence });
  }

  if (rendered.unknown.length) {
    rows.push({
      fieldKey: '__placeholders', label: 'Template placeholders', action: 'report',
      status: 'failed', detail: `left literal because no value was available: ${rendered.unknown.map((u) => `{{${u}}}`).join(', ')}`,
      control: null, value: null,
    });
  }

  return rows;
}

/** Performs the writes `planFill` decided on. Everything else passes through unchanged. */
export async function executeFill(rows: FillRow[], ctx: ApplyContext = {}): Promise<FillRow[]> {
  const done: FillRow[] = [];
  // Serial on purpose: a widget that re-renders on change can invalidate the
  // element another adapter is holding.
  for (const row of rows) {
    if (row.action !== 'write') {
      done.push(row);
      continue;
    }
    if (!row.control) {
      // planFill always sets a control on a write row; this only guards the type.
      done.push({ ...row, status: 'failed', detail: 'internal error: write row has no control' });
      continue;
    }
    if (!row.control.el.isConnected) {
      // The one silent failure read-back cannot catch: an ASP.NET partial
      // postback (often triggered by an earlier adapter's own change event)
      // swapped this control's subtree out. Writing the detached node would
      // succeed and read back clean while the real form stays empty.
      // isConnected is realm-safe, so no window reference is needed here.
      done.push({ ...row, status: 'failed', detail: 'the control left the page since the form was scanned; rescan and retry' });
      continue;
    }
    const result = await applyValue(row.control, row.value, ctx);
    done.push({ ...row, status: result.status, detail: result.detail });
  }
  return done;
}

export async function runFill(args: PlanFillArgs, ctx: ApplyContext = {}): Promise<FillRow[]> {
  return executeFill(planFill(args), ctx);
}

function valueFor(
  fieldKey: string,
  { rendered, requestor, service }: { rendered: Rendered; requestor: RequestorFields; service: Captured | null },
): ValueOutcome {
  switch (fieldKey) {
    case 'ubitName':
      // The field's own placeholder reads "If unknown, please state so."
      return { kind: 'value', value: requestor.ubitName || 'Unknown' };
    case 'briefSummary':
      return rendered.summary
        ? { kind: 'value', value: rendered.summary }
        : { kind: 'blocked', status: 'skipped', detail: 'the selected template has no summary' };
    case 'description':
      return rendered.descriptionHtml
        ? { kind: 'value', value: rendered.descriptionHtml }
        : { kind: 'blocked', status: 'skipped', detail: 'the selected template has no description' };
    case 'source':
      return { kind: 'value', value: byKey('source')?.fixedValue ?? '' };
    case 'service':
      return service?.id && service.text
        ? { kind: 'value', value: service }
        : { kind: 'blocked', status: 'needs-confirm', detail: 'no confirmed service — pick or confirm one in the panel before filling' };
    default:
      return { kind: 'blocked', status: 'skipped', detail: OUT_OF_SCOPE };
  }
}

function report(def: FieldDef, status: FillStatus, detail: string): FillRow {
  return { fieldKey: def.key, label: def.label, action: 'report', value: null, status, detail, control: null };
}

function truncate(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}
