// Marks the controls a fill just wrote, on the page itself.
import type { FillRow } from '../types.ts';

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
