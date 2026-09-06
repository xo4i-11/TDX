// Fills in a chosen issue template with the requestor's details to produce a summary and description.
/**
 * Issue templates and placeholder substitution.
 *
 * Descriptions are written as notes for the next technician: past tense, what
 * was done and what was verified, specific enough that whoever picks up a
 * follow-up knows what has already been ruled out.
 */

import type { RequestorFields, Template } from '../types.ts';

/** Placeholder names {{...}} may reference. Anything else is reported as unknown, not substituted. */
const SUPPORTED = ['name', 'ubitName', 'email', 'personNumber', 'date'];
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** requestorFields, plus the render-time-only `date` placeholder value. */
type SubstituteValues = Record<string, string | null | undefined>;

/** A requestor with every field explicitly null — the base a partial read is merged onto. Lives here so panel.ts can share it rather than keep a second copy. */
export const EMPTY_REQUESTOR: RequestorFields = {
  name: null,
  email: null,
  personGuid: null,
  personNumber: null,
  ubitName: null,
  title: null,
  organization: null,
};

export const SHIPPED_TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    summary: '',
    descriptionHtml: '',
    service: null,
  },
  {
    id: 'eduroam',
    name: 'Set up eduroam',
    summary: 'eduroam setup — {{ubitName}}',
    descriptionHtml: '<p>Walk-in. Set up eduroam for {{name}} ({{ubitName}}) on {{date}}.</p>'
      + '<ul><li>Removed the stale eduroam profile from the device.</li>'
      + '<li>Ran the eduroam CAT configuration tool.</li>'
      + '<li>Signed in with UBITName credentials and accepted the certificate prompt.</li>'
      + '<li>Confirmed the device pulled an address and reached the internet before they left.</li></ul>',
    service: null,
  },
  {
    id: 'password-reset',
    name: 'Reset UBITName password',
    summary: 'UBITName password reset — {{ubitName}}',
    descriptionHtml: '<p>Walk-in. UBITName password reset for {{name}} ({{ubitName}}) on {{date}}.</p>'
      + '<ul><li>Photo ID verified in person against the account record.</li>'
      + '<li>User set the password themselves; staff never sees or handles it.</li>'
      + '<li>Reminded them to update saved credentials on phones, tablets, and eduroam profiles.</li>'
      + '<li>Confirmed sign-in before they left.</li></ul>',
    service: null,
  },
  {
    id: 'duo',
    name: 'Set up Duo two-step',
    summary: 'Duo two-step enrollment — {{ubitName}}',
    descriptionHtml: '<p>Walk-in. Duo two-step enrollment for {{name}} ({{ubitName}}) on {{date}}.</p>'
      + '<ul><li>Identity verified in person.</li>'
      + '<li>Duo Mobile installed and the device enrolled.</li>'
      + '<li>Push notification tested end to end.</li>'
      + '<li>Backup method discussed so a lost phone does not lock the account out.</li></ul>',
    service: null,
  },
];

/**
 * Replaces every {{placeholder}} in `text` with its value from `values`.
 *
 * A placeholder that isn't in SUPPORTED, or that resolves to a missing/empty
 * value, is left as literal text and its name is reported in `unknown` —
 * never silently blanked, so a typo'd template or a missing field is visible
 * in the results panel rather than shipping a hole in the ticket.
 */
export function substitute(
  text: string,
  values: SubstituteValues,
  { escape = false }: { escape?: boolean } = {},
): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(PLACEHOLDER, (whole: string, key: string) => {
    const value = SUPPORTED.includes(key) ? values[key] : undefined;
    if (value === undefined || value === null || value === '') {
      unknown.push(key);
      return whole;
    }
    return escape ? escapeHtml(value) : value;
  });
  return { text: out, unknown };
}

/**
 * Renders one template against a parsed requestor. The summary is plain text
 * (never escaped — escaping it would show `&amp;` to the technician); the
 * description is HTML written into a rich-text editor, so every substituted
 * value crosses an untrusted-input-into-HTML boundary and must be escaped.
 */
export function renderTemplate(
  template: Template,
  requestorFields: RequestorFields = EMPTY_REQUESTOR,
  { now = new Date() }: { now?: Date } = {},
): { summary: string; descriptionHtml: string; unknown: string[] } {
  const values: SubstituteValues = { ...requestorFields, date: formatDate(now) };
  const summary = substitute(template.summary, values);
  const description = substitute(template.descriptionHtml, values, { escape: true });
  return {
    summary: summary.text,
    descriptionHtml: description.text,
    unknown: [...new Set([...summary.unknown, ...description.unknown])],
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ponytail: hand-rolled escape of the five characters that matter in HTML text
// content plus quoted attributes, rather than pulling in a sanitizer dependency.
// Upgrade to a real sanitizer only if descriptionHtml ever needs to carry
// requestor-supplied markup instead of just requestor-supplied text.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
