// Computes a short, stable id for a form's structure, so learned field mappings can be keyed to "this form" rather than to the URL that happened to load it.
/**
 * Deliberately NOT the URL: TDX URLs carry session ids, app ids, and a
 * RequestorUID, none of which describe the form's structure. The signature is
 * the sorted set of attribute ids present plus the parent form id, so it stays
 * constant across sessions and changes exactly when an administrator edits the
 * form — which is when a learned mapping should stop being trusted.
 *
 * On a form with no data-fieldid markers at all the id set is empty, and the
 * signature would degenerate to the parent form id alone — an administrator
 * could then add or remove fields without invalidating anything. So the
 * harvested control keys stand in for the ids in that case: same property,
 * different source.
 */

import { harvest } from './harvest.ts';

export function formSignature(root: Document | Element): string {
  const ids = [...root.querySelectorAll('[data-fieldid]')]
    .map((el) => el.getAttribute('data-fieldid'))
    .filter((id): id is string => Boolean(id))
    .sort();

  const parent = root.querySelector('input[name="ParentFormID"]')?.getAttribute('value')
    ?? root.querySelector('input[name="FormID"]')?.getAttribute('value')
    ?? '';

  const parts = ids.length ? ids : harvest(root).map((c) => c.key).sort();

  return fnv1a(`${parent}|${parts.join(',')}`);
}

// FNV-1a: short, dependency-free, and collision resistance is irrelevant here —
// ponytail: a collision would only mean reusing a learned mapping, which the
// results panel surfaces anyway; upgrade to a real digest only if that proves
// to bite in practice.
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
