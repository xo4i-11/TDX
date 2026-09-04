// Turns a list of fill outcomes into the panel's results list, and outlines on the page which controls got written.
/**
 * The design rule this file exists to serve: when TDX changes, the technician
 * must see "Location — wrote 139, read back nothing", not a form that looks
 * fine and submits wrong. So failures sort to the top, every row carries a
 * reason, and low-confidence matches are flagged even when they succeeded.
 */

import type { FillRow, FillStatus } from '../types.ts';

type Tone = 'good' | 'warn' | 'bad' | 'mute';

interface StatusInfo {
  icon: string;
  tone: Tone;
  order: number;
}

export const STATUS_META: Record<FillStatus, StatusInfo> = {
  failed: { icon: '✕', tone: 'bad', order: 0 },
  'needs-confirm': { icon: '⚠', tone: 'warn', order: 1 },
  preserved: { icon: '•', tone: 'mute', order: 2 },
  skipped: { icon: '–', tone: 'mute', order: 3 },
  filled: { icon: '✓', tone: 'good', order: 4 },
};

const LOW_CONFIDENCE = 0.6;

/** One entry a correction dropdown can offer instead of the field a row was matched to. */
export interface FieldOption {
  key: string;
  label: string;
}

export interface RenderResultsOptions {
  /** The document the panel's own elements are created in — never the bare global. */
  doc: Document;
  /** Called when the technician picks a different field for a filled control. */
  onCorrect?: (controlKey: string, fieldKey: string) => void;
  fieldOptions?: FieldOption[];
}

/** Builds the `<ul class="results">` for one fill run, worst outcomes first. */
export function renderResults(rows: FillRow[], { doc, onCorrect, fieldOptions = [] }: RenderResultsOptions): HTMLElement {
  const list = doc.createElement('ul');
  list.className = 'results';

  const sorted = [...rows].sort((a, b) => {
    const byStatus = meta(a.status).order - meta(b.status).order;
    return byStatus !== 0 ? byStatus : a.label.localeCompare(b.label);
  });

  for (const row of sorted) {
    const info = meta(row.status);
    const lowConfidence = typeof row.confidence === 'number' && row.confidence <= LOW_CONFIDENCE;
    // A low-confidence match is flagged like needs-confirm even though it
    // filled — a technician skimming icons must not read "✓" as "trust it".
    const tone: Tone = lowConfidence && info.tone === 'good' ? 'warn' : info.tone;
    const iconChar = lowConfidence && info.tone === 'good' ? STATUS_META['needs-confirm'].icon : info.icon;

    const item = doc.createElement('li');
    item.className = 'result';
    item.dataset.tone = tone;
    item.dataset.field = row.fieldKey;

    const icon = doc.createElement('span');
    icon.className = 'icon';
    icon.textContent = iconChar;
    icon.setAttribute('aria-hidden', 'true');

    const name = doc.createElement('span');
    name.className = 'name';
    name.textContent = row.label;

    const detail = doc.createElement('span');
    detail.className = 'detail';
    detail.textContent = [
      row.status,
      row.detail || null,
      lowConfidence ? `matched at ${row.confidence} confidence — check this one` : null,
    ].filter((part): part is string => Boolean(part)).join(' — ');

    item.append(icon, name, detail);

    if (onCorrect && row.control && fieldOptions.length) {
      item.append(correctionControl(doc, row, row.control.key, fieldOptions, onCorrect));
    }

    list.append(item);
  }

  return list;
}

function correctionControl(
  doc: Document,
  row: FillRow,
  controlKey: string,
  fieldOptions: FieldOption[],
  onCorrect: (controlKey: string, fieldKey: string) => void,
): HTMLSelectElement {
  const select = doc.createElement('select');
  select.setAttribute('aria-label', `Correct the field mapped to ${row.label}`);

  const keep = doc.createElement('option');
  keep.value = '';
  keep.textContent = 'Mapped correctly';
  select.append(keep);

  for (const option of fieldOptions) {
    if (option.key === row.fieldKey) continue;
    const el = doc.createElement('option');
    el.value = option.key;
    el.textContent = `Actually: ${option.label}`;
    select.append(el);
  }

  select.addEventListener('change', () => {
    if (select.value) onCorrect(controlKey, select.value);
  });
  return select;
}

/**
 * Outlines the controls the fill actually wrote, so the technician can see at
 * a glance what was touched without reading the list. Clears any previous
 * outline first, since a second fill can touch a different set of controls.
 */
export function highlightFilled(rows: FillRow[], doc: Document): void {
  injectHighlightStyle(doc);
  for (const el of doc.querySelectorAll('.tdxa-touched')) el.classList.remove('tdxa-touched');
  for (const row of rows) {
    if (row.status !== 'filled') continue;
    row.control?.el.classList.add('tdxa-touched');
  }
}

function injectHighlightStyle(doc: Document): void {
  if (doc.querySelector('style[data-tdxa-highlight]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-tdxa-highlight', '');
  style.textContent = '.tdxa-touched { outline: 2px dashed #f0a71c !important; outline-offset: 1px !important; }';
  (doc.head ?? doc.documentElement).append(style);
}

/** Status meta, widened to cover the transient 'pending' row a plan produces before it's executed. */
function meta(status: FillRow['status']): StatusInfo {
  if (status === 'pending') return { icon: '…', tone: 'mute', order: 9 };
  return STATUS_META[status];
}
