// Decides which canonical field each harvested control actually is, from strongest evidence to weakest.
/**
 * Four tiers, highest wins:
 *   0  a mapping the technician corrected on this form signature
 *   1  TDX's own data-fieldtype marker
 *   2  TDX's own data-fieldid, stable instance-wide
 *   3  weighted scoring over label, option set, name, id, placeholder, aria
 *
 * Tier 3 is computed for every control even when a higher tier wins, because
 * diagnostics needs the runners-up and because tier 3 is what carries a form
 * — or an institution — this code has never seen.
 */

import { DICTIONARY } from './dictionary.ts';
import type { Control, Diag, FieldDef, Match, Resolution } from '../types.ts';

export const LOW_CONFIDENCE = 0.6;

const TIER_LEARNED = 1;
const TIER_FIELDTYPE = 0.95;
const TIER_FIELDID = 0.9;
// Tier 3 can never claim the certainty of a TDX-supplied marker, however
// convincing a label looks.
const TIER3_CEILING = 0.85;

/** One field candidate for one control: everything the assignment pass and diagnostics need. */
interface Candidate {
  fieldKey: string;
  control: Control;
  confidence: number;
  tier: 0 | 1 | 2 | 3;
  evidence: string;
  raw: number;
}

export interface ResolveOptions {
  dictionary?: FieldDef[];
  learned?: Record<string, string>;
}

export function resolve(controls: Control[], options: ResolveOptions = {}): Resolution {
  const dictionary = options.dictionary ?? DICTIONARY;
  const learned = options.learned ?? {};

  const candidates: Candidate[] = [];
  const diagnostics: Diag[] = [];

  for (const control of controls) {
    const scored: Candidate[] = [];

    for (const def of dictionary) {
      const tier3 = scoreTier3(control, def);
      let raw = tier3.raw;
      let confidence = Math.min(TIER3_CEILING, tier3.raw);
      let tier: 0 | 1 | 2 | 3 = 3;
      let evidence = tier3.evidence;

      if (control.fieldId && def.fieldIds.includes(control.fieldId)) {
        raw = 10;
        confidence = TIER_FIELDID;
        tier = 2;
        evidence = `data-fieldid="${control.fieldId}"`;
      }
      if (control.fieldType && def.fieldTypes.includes(control.fieldType)) {
        raw = 20;
        confidence = TIER_FIELDTYPE;
        tier = 1;
        evidence = `data-fieldtype="${control.fieldType}"`;
      }
      if (learned[control.key] === def.key) {
        raw = 100;
        confidence = TIER_LEARNED;
        tier = 0;
        evidence = 'learned from a previous correction on this form';
      }

      if (raw <= 0) continue;
      const candidate: Candidate = { fieldKey: def.key, control, confidence, tier, evidence, raw };
      candidates.push(candidate);
      scored.push(candidate);
    }

    scored.sort(byRawDescending);
    diagnostics.push({
      control,
      winner: null, // filled in after assignment
      runnersUp: scored.slice(1, 4).map(({ fieldKey, raw, evidence }) => ({ fieldKey, score: raw, evidence })),
    });
  }

  // Globally best-match assignment: take the strongest pair available, claim
  // both sides, repeat. Prevents two fields from grabbing the same control and
  // makes the result independent of DOM order.
  candidates.sort(byRawDescending);
  const byField = new Map<string, Match>();
  const byControl = new Map<string, Match>();
  for (const candidate of candidates) {
    if (byField.has(candidate.fieldKey)) continue;
    if (byControl.has(candidate.control.key)) continue;
    const match: Match = {
      fieldKey: candidate.fieldKey,
      control: candidate.control,
      confidence: candidate.confidence,
      tier: candidate.tier,
      evidence: candidate.evidence,
    };
    byField.set(candidate.fieldKey, match);
    byControl.set(candidate.control.key, match);
  }

  for (const diag of diagnostics) {
    diag.winner = byControl.get(diag.control.key) ?? null;
    diag.runnersUp = diag.runnersUp.filter((r) => r.fieldKey !== diag.winner?.fieldKey);
  }

  const unresolvedFields = dictionary.map((d) => d.key).filter((key) => !byField.has(key));

  return { byField, byControl, unresolvedFields, diagnostics };
}

// Raw scores are compared before the tier-3 ceiling is applied, so an exact
// label match still outranks a substring match even though both report 0.85.
function byRawDescending(a: Candidate, b: Candidate): number {
  if (b.raw !== a.raw) return b.raw - a.raw;
  return a.fieldKey.localeCompare(b.fieldKey);
}

function scoreTier3(control: Control, def: FieldDef): { raw: number; evidence: string } {
  const reasons: string[] = [];
  let score = 0;

  const label = control.label?.toLowerCase() ?? '';
  const defLabels = def.labels.map((l) => l.toLowerCase());

  if (label && defLabels.includes(label)) {
    score = Math.max(score, 1);
    reasons.push(`label exactly "${control.label}"`);
  } else if (label && defLabels.some((l) => label.includes(l))) {
    score = Math.max(score, 0.7);
    reasons.push(`label contains "${defLabels.find((l) => label.includes(l))}"`);
  }

  if (def.options.length && control.options.length) {
    const known = new Set(def.options.map((o) => o.toLowerCase()));
    const hits = control.options.filter((o) => known.has(o.toLowerCase())).length;
    const overlap = hits / def.options.length;
    if (overlap > 0) {
      score = Math.max(score, 0.9 * overlap);
      reasons.push(`${hits}/${def.options.length} known option strings`);
    }
  }

  const identifier = `${control.name ?? ''} ${control.id ?? ''}`;
  if (def.patterns.some((p) => p.test(identifier))) {
    score = Math.max(score, 0.5);
    reasons.push('name or id fragment');
  }

  const soft = `${control.placeholder ?? ''} ${control.aria ?? ''}`;
  if (soft.trim() && def.patterns.some((p) => p.test(soft))) {
    score = Math.max(score, 0.4);
    reasons.push('placeholder or aria text');
  }

  if (score > 0 && !shapeMatches(control.shape, def.control)) {
    // Not disqualifying: TDX administrators do convert a textbox into a
    // dropdown, and a strong label should still surface the field for review.
    score *= 0.3;
    reasons.push(`shape mismatch (${control.shape} vs ${def.control})`);
  }

  return { raw: score, evidence: reasons.join(', ') || 'no signal' };
}

function shapeMatches(shape: Control['shape'], expected: FieldDef['control']): boolean {
  if (expected === 'select') return shape === 'select' || shape === 'select2';
  return shape === expected;
}
