// Turns a captured TDX "Ticket Resolved" comment into a {{steps}} template.
/**
 * TDX's resolved-ticket boilerplate marks the part you are meant to replace by
 * colouring it red. That is a visual convention, not a marker, so this reads
 * the colour rather than a class or an id — and shows the technician what it
 * matched instead of trusting itself (see the panel's capture preview).
 */

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TD', 'BLOCKQUOTE', 'SECTION']);

/** One red run found in a captured body, with the block that would be replaced. */
export interface RedBlock {
  index: number;
  /** The red run's own text, for the preview. */
  text: string;
  /** The whole block that would be replaced, so the preview can show what is lost. */
  html: string;
}

export function findRedBlocks(html: string, doc: Document): RedBlock[] {
  const { blocks } = analyse(html, doc);
  return blocks.map(({ el, run }, index) => ({
    index,
    text: (run.textContent ?? '').trim(),
    html: el.outerHTML,
  }));
}

/**
 * Replaces the chosen red run's whole block with a bare `{{steps}}`
 * placeholder. The block, not the run: substituting a `<ul>` into the middle of
 * a `<p>` produces markup CKEditor silently rearranges.
 */
export function toStepsTemplate(html: string, doc: Document, index: number): string {
  const { root, blocks } = analyse(html, doc);
  const target = blocks[index];
  if (!target) return html;

  const placeholder = root.ownerDocument.createElement('p');
  placeholder.textContent = '{{steps}}';
  target.el.replaceWith(placeholder);
  return root.innerHTML;
}

/** Parses once and pairs every red run with its block. Shared so both exports agree on what "block 0" means. */
function analyse(html: string, doc: Document): { root: HTMLElement; blocks: { el: Element; run: Element }[] } {
  // A detached document: parsing into the live page would run nothing (no
  // scripts, no resource loads) but would still be someone else's DOM to mutate.
  const parsed = doc.implementation.createHTMLDocument('');
  parsed.body.innerHTML = html;

  const blocks: { el: Element; run: Element }[] = [];
  const seen = new Set<Element>();
  for (const run of parsed.body.querySelectorAll('*')) {
    if (!isRed(run)) continue;
    const el = blockAncestor(run, parsed.body);
    if (seen.has(el)) continue;
    seen.add(el);
    blocks.push({ el, run });
  }
  return { root: parsed.body, blocks };
}

function blockAncestor(run: Element, root: Element): Element {
  let el: Element | null = run;
  while (el && el.parentElement && el.parentElement !== root && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  // A red run directly under the body with no block wrapper: replace the run.
  return el && BLOCK_TAGS.has(el.tagName) ? el : run;
}

function isRed(el: Element): boolean {
  const attr = el.getAttribute('color');
  if (attr && isRedValue(attr.trim().toLowerCase())) return true;

  const style = el.getAttribute('style');
  if (!style) return false;
  const colour = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1];
  return Boolean(colour && isRedValue(colour.trim().toLowerCase()));
}

/** Red-dominant, not "any warm colour": r must be high and clearly beat both g and b. */
function isRedValue(value: string): boolean {
  const rgb = parseColour(value);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return r >= 100 && r >= 2 * g && r >= 2 * b;
}

function parseColour(value: string): [number, number, number] | null {
  if (value === 'red') return [255, 0, 0];

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (!hex) return null;
  const digits = hex[1]!;
  const pair = (i: number): number => (digits.length === 3
    ? parseInt(digits[i]!.repeat(2), 16)
    : parseInt(digits.slice(i * 2, i * 2 + 2), 16));
  return [pair(0), pair(1), pair(2)];
}
