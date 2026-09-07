// Turns a block of text copied out of TDX into structured requestor fields.
/**
 * Parses a requestor block copied out of TDX into structured fields.
 *
 * Accepts both the markdown form (links preserved) and a plain-text paste.
 * Never throws: a malformed paste yields partial fields plus warnings, because
 * a parser that throws mid-shift is worse than one that reports what it missed.
 */

import type { RequestorFields } from '../types.ts';

const PERSON_GUID = /PersonDet\.aspx\?U=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const MAILTO = /\[[^\]]*\]\(mailto:([^)\s]+)\)/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
// "50583450 - duynghie". Person number is numeric; UBITName follows the dash.
export const ID_LINE = /^(\d{4,})\s*-\s*([A-Za-z0-9._-]+)$/;

export function parseRequestor(raw: string): { fields: RequestorFields; warnings: string[] } {
  const fields: RequestorFields = {
    name: null,
    email: null,
    personGuid: null,
    personNumber: null,
    ubitName: null,
    title: null,
    organization: null,
  };
  const warnings: string[] = [];

  const text = typeof raw === 'string' ? raw : '';
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^requestor:?$/i.test(l));

  // Each extraction is independent so one failure cannot cascade into the rest.
  fields.personGuid = text.match(PERSON_GUID)?.[1]?.toLowerCase() ?? null;

  const mailto = text.match(MAILTO)?.[1];
  fields.email = mailto ?? text.match(EMAIL)?.[0] ?? null;

  const idLineIndex = lines.findIndex((l) => ID_LINE.test(l));
  if (idLineIndex !== -1) {
    // ID_LINE just matched this exact line, so the match and its two groups exist.
    const match = lines[idLineIndex]!.match(ID_LINE)!;
    const [, number, ubit] = match;
    fields.personNumber = number!;
    // Authoritative. Never derive UBITName from the email local part: aliases exist.
    fields.ubitName = ubit!;
  }

  const remaining: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === idLineIndex) continue;
    if (fields.email && line.includes(fields.email)) continue;
    if (MAILTO.test(line)) continue;
    remaining.push(line);
  }

  if (remaining.length) {
    const first = remaining[0]!;
    const link = first.match(MD_LINK);
    // MD_LINK's first group is mandatory, so a match guarantees it.
    fields.name = link ? link[1]!.trim() : first;
    fields.title = remaining[1] ?? null;
    fields.organization = remaining[2] ?? null;
  }

  if (!fields.name) warnings.push('No name found.');
  if (!fields.email) warnings.push('No email found.');
  if (!fields.personGuid) {
    warnings.push('No person GUID found — TDX submits the GUID, so the requestor lookup cannot be driven from this paste.');
  }
  if (!fields.personNumber) warnings.push('No person number found.');
  if (!fields.ubitName) warnings.push('No UBITName found on the ID line.');

  return { fields, warnings };
}
