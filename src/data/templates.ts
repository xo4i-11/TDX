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
const SUPPORTED = ['name', 'ubitName', 'email', 'personNumber', 'date', 'time', 'steps'];
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** requestorFields, plus the render-time-only `date` and `time` placeholder values. */
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
    name: 'First Time Set Up Eduroam',
    summary: 'First Time Set Up Eduroam -- {{ubitName}}',
    descriptionHtml: '<p>Set up eduroam for {{name}} ({{ubitName}}) at {{time}} on {{date}}</p>',
    steps: 'Removed the stale eduroam profile from the device\nRan the eduroam CAT configuration tool\nSigned in with UBITName credentials and accepted the certificate prompt\nConfirmed the device reached the internet',
    service: null,
  },
  {
    id: 'eduroam-reconfigure',
    name: 'Reconfigure Eduroam',
    summary: 'Reconfigure eduroam -- {{ubitName}}',
    descriptionHtml: '<p>Reconfigure eduroam for {{name}} ({{ubitName}}) at {{time}} on {{date}}</p>',
    steps: 'Forgot the existing eduroam network on the device\nRe-ran the eduroam CAT configuration tool\nConfirmed the device reconnected and reached the internet',
    service: null,
  },
  {
    id: 'password-reset',
    name: 'Reset Password',
    summary: 'Reset Password -- {{ubitName}}',
    descriptionHtml: '<p>Reset password for {{name}} ({{ubitName}}) at {{time}} on {{date}}</p>',
    steps: 'Verified photo ID in person against the account record\nUser set the new password themselves\nReminded them to update saved credentials on phones, tablets and eduroam profiles\nConfirmed sign-in before they left',
    service: null,
  },
  {
    id: 'duo',
    name: 'Set Up Duo',
    summary: 'Set Up Duo -- {{ubitName}}',
    descriptionHtml: '<p>Set Up Duo for {{name}} ({{ubitName}}) at {{time}} on {{date}}</p>',
    steps: 'Verified identity in person\nInstalled Duo Mobile and enrolled the device\nTested a push notification end to end\nDiscussed a backup method in case the phone is lost',
    service: null,
  },
  {
    id: 'duo-bypass',
    name: 'Assign Duo Bypass Code',
    summary: 'Assign Duo Bypass Code -- {{ubitName}}',
    descriptionHtml: '<p>Assign Duo Bypass Code to {{name}} ({{ubitName}}) at {{time}} on {{date}}</p>',
    steps: 'Verified identity in person\nGenerated a bypass code and gave it to the requestor\nExplained that the code is single-use and expires\nConfirmed they could sign in with it',
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
  const values: SubstituteValues = { ...requestorFields, date: formatDate(now), time: formatTime(now) };
  const summary = substitute(template.summary, values);
  const description = substitute(template.descriptionHtml, values, { escape: true });
  return {
    summary: summary.text,
    descriptionHtml: description.text,
    unknown: [...new Set([...summary.unknown, ...description.unknown])],
  };
}

// Local, not UTC: a walk-up logged at 8pm Eastern belongs to that day and that
// clock reading, and an ISO/UTC stamp would put it on tomorrow's date.
function formatDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

/** "2:48 PM" — how a technician would write the time on a walk-up note. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * One bullet per non-blank line. Always a list, even for a single step — one
 * shape to reason about at the call site instead of two. Each line is escaped
 * here, so the result is substituted unescaped: the same split renderTemplate
 * already makes between the plain-text summary and the HTML description.
 */
export function stepsToHtml(steps: string): string {
  const lines = steps.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
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
