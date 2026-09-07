// Reads a TDX comment template out of the update page, without going through TDX's own menu.
/**
 * TDX renders its comment templates twice: once as `a.js-template` links in a
 * Bootstrap dropdown, and once as an inline script that assigns every body to
 * `responseTemplates[<id>]`, with the values for their placeholders in a
 * `templateJson` object beside it. Its own menu handler is
 * `$templates.click(... ckeCommentEditor.setData(Mustache.render(body, json)))`.
 *
 * This reads that data rather than clicking the menu. Driving someone else's
 * click handler meant depending on their CKEditor instance existing, their
 * jQuery binding having run, and their Mustache being loaded — all in the page
 * world, none of it observable from here, and it failed in exactly the way
 * that predicts: the click was dispatched, nothing happened, and the only
 * signal was a six-second timeout. The data is right there in the DOM.
 */

/** The values TDX substitutes into a template: technician and requestor names, dates, ticket ids. */
type TemplateValues = Record<string, unknown>;

/**
 * Finds one template link by its visible name, preferring the named group.
 *
 * Names are matched exactly (trimmed, case-insensitive) because "Ticket
 * Resolved", "Ticket Resolved - No Response" and "@Ticket Resolved" all exist
 * side by side in this menu, and a substring match would pick whichever came
 * first in the DOM.
 */
export function findTemplateLink(doc: Document, name: string, group?: string): HTMLAnchorElement | null {
  const wanted = name.trim().toLowerCase();
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a.js-template')]
    .filter((link) => (link.textContent ?? '').trim().toLowerCase() === wanted);
  if (!links.length) return null;
  if (!group) return links[0] ?? null;

  const wantedGroup = group.trim().toLowerCase();
  const inGroup = links.find((link) => {
    // The submenu's own label is the anchor immediately before the <ul> this
    // link sits in — TDX's markup is <li class="dropdown-submenu"><a>ALL</a><ul>…
    const submenu = link.closest('li.dropdown-submenu');
    const label = submenu?.querySelector('a')?.textContent?.trim().toLowerCase();
    return label === wantedGroup;
  });
  // Falling back to the first same-named link is deliberate: a renamed group
  // should not silently stop the flow when the template itself is still there.
  return inGroup ?? links[0] ?? null;
}

export type TemplateRead = { html: string } | { error: string };

/** The template's body with TDX's own placeholder values substituted, ready to write into the comment. */
export function readTemplateHtml(doc: Document, name: string, group?: string): TemplateRead {
  const link = findTemplateLink(doc, name, group);
  if (!link) return { error: `Templates > ${group ?? 'any group'} > ${name} is not in this page menu` };

  const id = link.dataset.templateId;
  if (!id) return { error: `the "${name}" template link carries no template id` };

  const source = scriptContaining(doc, `responseTemplates[${id}]`);
  if (!source) return { error: `the page holds no body for template ${id}` };

  const body = assignedString(source, `responseTemplates[${id}]`);
  if (body === null) return { error: `the body for template ${id} could not be read from the page` };

  return { html: render(body, valuesIn(source)) };
}

/** The inline script that assigns the bodies — found by content, since it has no id of its own. */
function scriptContaining(doc: Document, needle: string): string | null {
  for (const script of doc.querySelectorAll('script')) {
    const text = script.textContent ?? '';
    if (text.includes(needle)) return text;
  }
  return null;
}

/**
 * Reads `<assignment> = "…";` — a JavaScript double-quoted string whose escapes
 * (\u003c for <, \r\n, \\") are all JSON's too, so JSON.parse is the parser
 * rather than a hand-rolled unescaper.
 */
function assignedString(source: string, assignment: string): string | null {
  const start = source.indexOf(assignment);
  if (start === -1) return null;
  const quote = source.indexOf('"', start);
  if (quote === -1) return null;

  // Walks to the closing quote so an escaped quote inside the body does not
  // end it early — the bodies are full of \\" from inline style attributes.
  let i = quote + 1;
  for (; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '"') break;
  }
  try {
    return JSON.parse(source.slice(quote, i + 1)) as string;
  } catch {
    return null;
  }
}

/** The `templateJson: { … }` object literal beside the bodies, read by matching its braces. */
function valuesIn(source: string): TemplateValues {
  const key = source.indexOf('templateJson:');
  if (key === -1) return {};
  const open = source.indexOf('{', key);
  if (open === -1) return {};

  let depth = 0;
  let inString = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(source.slice(open, i + 1)) as TemplateValues;
      } catch {
        return {};
      }
    }
  }
  return {};
}

/**
 * Mustache's substitution, minus Mustache: `{{Key}}` and `{{{Key}}}` (the
 * triple form TDX uses for the signature, which is HTML). A key the page has
 * no value for is left standing rather than blanked — a placeholder still in
 * the comment is visible; a silently emptied one is not.
 */
function render(body: string, values: TemplateValues): string {
  return body.replace(/\{\{\{?\s*([\w.]+)\s*\}?\}\}/g, (whole, key: string) => {
    if (!(key in values)) return whole;
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}
