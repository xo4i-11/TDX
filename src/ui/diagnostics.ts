// Formats and renders the diagnostic dump: what the resolver saw for every control, and exactly why it decided what it decided.
/**
 * The design rule this file exists to serve: when a match looks wrong, the
 * person tuning the dictionary needs the resolver's *reasoning*, not just its
 * output — which tier fired, what the confidence was, and which fields nearly
 * won. It is plain text rather than a table because it has to survive being
 * pasted into a ticket, a chat message, or an issue without reformatting.
 *
 * Trust boundary: this dump is built to be pasted somewhere off this machine,
 * so it may only carry form structure and resolver reasoning (control labels,
 * markers, shapes, scores, the form signature) — never a filled or requestor
 * value. Two things make that true, and only those two: `Resolution.diagnostics`
 * never holds a value, so this file never reads a `FillRow.value` or a
 * `RequestorFields`; and the page URL is printed with its query string cut off,
 * because a TDX ticket-form URL carries `RequestorUID=<person GUID>` — the one
 * identifier this project refuses to persist anywhere at all.
 */

import type { Resolution } from '../types.ts';

export interface DiagnosticsOptions {
  /** The form signature (src/core/signature.ts), so a learned mapping can be traced back to the dump. */
  signature?: string;
  /** The page URL, included only when the caller has one worth recording. */
  url?: string;
}

/** Renders every harvested control, its markers, and what the resolver decided about it, as pasteable plain text. */
export function formatDiagnostics(resolution: Resolution, { signature = '', url = '' }: DiagnosticsOptions): string {
  const lines: string[] = [
    'TDX Autofill — resolution diagnostics',
    `form signature: ${signature}`,
  ];
  // Path only. The query string is where TDX puts RequestorUID (the requestor's
  // person GUID), and this text is built to be pasted into a ticket or a chat.
  if (url) lines.push(`page: ${url.split('?')[0] ?? ''}`);
  lines.push(`controls harvested: ${resolution.diagnostics.length}`);
  lines.push(`fields resolved: ${resolution.byField.size}`);
  lines.push('');

  for (const { control, winner, runnersUp } of resolution.diagnostics) {
    lines.push(`- ${control.label ?? '(no label)'}`);
    lines.push(`    id=${control.id ?? '-'}  name=${control.name ?? '-'}  shape=${control.shape}`);
    lines.push(`    data-fieldtype=${control.fieldType ?? '-'}  data-fieldid=${control.fieldId ?? '-'}`);
    if (control.options.length) {
      const shown = control.options.filter(Boolean).slice(0, 8);
      lines.push(`    options: ${shown.join(' | ')}${control.options.length > 8 ? ' | ...' : ''}`);
    }
    if (winner) {
      lines.push(`    -> ${winner.fieldKey}  confidence=${winner.confidence}  tier=${winner.tier}  (${winner.evidence})`);
    } else {
      lines.push('    -> unresolved');
    }
    lines.push(`    runners-up: ${runnersUp.length ? runnersUp.map((r) => `${r.fieldKey}=${round(r.score)}`).join(', ') : 'none'}`);
    lines.push('');
  }

  if (resolution.unresolvedFields.length) {
    lines.push(`fields with no control on this form: ${resolution.unresolvedFields.join(', ')}`);
  }

  return lines.join('\n');
}

export interface RenderDiagnosticsOptions {
  /** The document the diagnostics section is created in — never the bare global. */
  doc: Document;
}

/** Wraps a formatted dump in a `<section>` with a copy-to-clipboard button. */
export function renderDiagnostics(text: string, { doc }: RenderDiagnosticsOptions): HTMLElement {
  const wrap = doc.createElement('section');

  const heading = doc.createElement('h2');
  heading.textContent = 'Diagnostics';

  const pre = doc.createElement('pre');
  pre.className = 'diagnostics';
  pre.tabIndex = 0;
  pre.textContent = text;

  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy diagnostics';
  copy.addEventListener('click', () => {
    // Realm-safe: reach the clipboard through this document's own window,
    // never the bare global `window` (this panel can run inside an iframe).
    doc.defaultView?.navigator.clipboard?.writeText(text);
  });

  wrap.append(heading, pre, copy);
  return wrap;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
