// Walks a TDX ticket form and lists every fillable control, along with every signal that hints at what it is.
/**
 * Enumerates fillable controls and gathers every signal that could identify
 * them. Deliberately makes no judgement about what any control means — that is
 * the resolver's job, and keeping the two apart is what lets the resolver be
 * tested against markup this file has never special-cased.
 */

import type { Control, ControlShape } from '../types.ts';

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file']);

// Exported so any other module that needs "the field's group boundary" (see
// richtext.ts) uses this exact selector rather than a narrower copy that can
// drift — a field whose group is marked only by data-fieldtype/data-fieldid
// (no .form-group class) would otherwise resolve to the wrong ancestor.
export const GROUP_SELECTOR = '.form-group, [data-fieldtype], [data-fieldid]';

export function harvest(root: Document | Element): Control[] {
  const doc: Document = root.ownerDocument ?? (root as Document);
  const controls: Control[] = [];
  const claimed = new Set<Element>();

  // Lookups first. They span three elements, and claiming all three up front
  // stops the visible half from surfacing again as a lone text input.
  for (const hidden of root.querySelectorAll<HTMLInputElement>('input[data-selectlookup="true"], input[data-wsurl]')) {
    const base = hidden.id || hidden.getAttribute('name');
    if (!base) continue;
    const input = doc.getElementById(`${base}_input`) as HTMLInputElement | null
      ?? root.querySelector<HTMLInputElement>(`[name="${base}_input"]`);
    const reset = doc.getElementById(`${base}_reset`) as HTMLInputElement | null;
    if (!input) continue;

    claimed.add(hidden);
    claimed.add(input);
    if (reset) claimed.add(reset);

    controls.push(describe(hidden, doc, {
      shape: 'lookup',
      lookup: { hidden, input, reset: reset ?? null },
    }));
  }

  // Rich text. TDX renders the description as a hidden textarea named
  // <id>_Content that CKEditor replaces at runtime, so the textarea is the
  // stable handle even though it is display:none.
  for (const textarea of root.querySelectorAll<HTMLTextAreaElement>('textarea[id$="_Content"]')) {
    claimed.add(textarea);
    controls.push(describe(textarea, doc, {
      shape: 'richtext',
      richtext: { textarea, instanceKey: textarea.id },
    }));
  }

  for (const el of root.querySelectorAll('input, select, textarea, [contenteditable="true"]')) {
    if (claimed.has(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && SKIP_TYPES.has(type)) continue;
    // Radios stay skipped: they are a group sharing one value, and nothing in
    // either fill set is one. A checkbox is a single boolean control.
    if (tag === 'input' && type === 'radio') continue;
    // select2 and Kendo both leave decorative inputs in the DOM. They carry no
    // name, so they can never be a real form value.
    if (tag === 'input' && !el.getAttribute('name') && !el.id?.startsWith('attribute')) continue;
    if (el.classList.contains('select2-input') || el.classList.contains('select2-focusser')) continue;

    if (tag === 'select') {
      const shape = el.classList.contains('js-select2') ? 'select2' : 'select';
      controls.push(describe(el, doc, { shape }));
    } else if (tag === 'input' && type === 'checkbox') {
      controls.push(describe(el, doc, { shape: 'checkbox' }));
    } else if (el.hasAttribute('contenteditable')) {
      // A contenteditable with no CKEditor textarea behind it (none in the
      // fixture, but conceivable elsewhere) — still richtext, just with no
      // instance key to hand the bridge.
      controls.push(describe(el, doc, { shape: 'richtext' }));
    } else {
      controls.push(describe(el, doc, { shape: 'text' }));
    }
  }

  return controls;
}

/** What varies per control: its shape, and — only for lookup/richtext — the extra elements that shape carries. */
interface DescribeExtra {
  shape: ControlShape;
  lookup?: NonNullable<Control['lookup']>;
  richtext?: NonNullable<Control['richtext']>;
}

function describe(el: Element, doc: Document, extra: DescribeExtra): Control {
  const group = el.closest(GROUP_SELECTOR);
  const options = el.tagName.toLowerCase() === 'select'
    ? [...el.querySelectorAll('option')].map((o) => o.textContent.trim()).filter(Boolean)
    : [];

  return {
    key: el.id || el.getAttribute('name') || `${el.tagName}:${indexOf(doc, el)}`,
    el,
    shape: extra.shape,
    fieldType: group?.getAttribute('data-fieldtype') ?? null,
    fieldId: group?.getAttribute('data-fieldid') ?? null,
    label: findLabel(el, group, doc),
    name: el.getAttribute('name'),
    id: el.id || null,
    placeholder: el.getAttribute('placeholder'),
    aria: ariaText(el, doc),
    options,
    lookup: extra.lookup ?? null,
    richtext: extra.richtext ?? null,
  };
}

/**
 * Label discovery, most reliable signal first. TDX uses <label for> throughout,
 * but the fallbacks matter for forms built by other means and for the
 * marker-stripped case the resolver must still handle.
 */
function findLabel(el: Element, group: Element | null, doc: Document): string | null {
  const targets = [el.id, ...(el.id ? [`${el.id}_Content`] : [])].filter(Boolean);
  for (const target of targets) {
    const explicit = doc.querySelector(`label[for="${cssEscape(target)}"]`);
    if (explicit) return clean(explicit.textContent);
  }
  const ancestor = el.closest('label');
  if (ancestor) return clean(ancestor.textContent);

  const nearby = group?.querySelector('label, th, .control-label');
  if (nearby) return clean(nearby.textContent);

  return null;
}

function ariaText(el: Element, doc: Document): string | null {
  const direct = el.getAttribute('aria-label');
  if (direct) return clean(direct);
  const ref = el.getAttribute('aria-labelledby');
  if (!ref) {
    const title = el.getAttribute('title');
    return title ? clean(title) : null;
  }
  const parts = ref.split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent)
    .filter((text): text is string => Boolean(text));
  return parts.length ? clean(parts.join(' ')) : null;
}

function clean(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed || null;
}

function indexOf(doc: Document, el: Element): number {
  return [...doc.querySelectorAll(el.tagName)].indexOf(el);
}

// jsdom lacks CSS.escape in some versions, and TDX ids are alphanumeric anyway.
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
