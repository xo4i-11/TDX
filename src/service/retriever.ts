// Ranks which TDX service a new ticket description probably belongs to, by comparing it against the technician's own saved examples of past tickets.
import type { Example, Ranked } from '../types.ts';

/**
 * Ranks candidate services for a ticket description against examples the
 * technician has explicitly confirmed and saved.
 *
 * This is retrieval over a local corpus, not RAG and not a model. There is no
 * access to TDX ticket history: the corpus starts empty and only grows when
 * someone saves a fill they were happy with. An empty corpus suggests nothing,
 * which is the point — a cold-start guess into a routing field is worse than
 * no suggestion at all.
 *
 * The exported shape is the seam: swapping TF-IDF for an embedding retriever
 * later means writing one module that returns the same array. Nothing above
 * this file changes.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'not', 'of',
  'on', 'or', 'she', 'that', 'the', 'their', 'them', 'then', 'they', 'this',
  'to', 'was', 'were', 'will', 'with', 'you', 'your',
]);

// One evidence line before it's trimmed down to the public shape — carries the
// per-example score so the best matches can be picked and sorted.
interface ScoredEvidence {
  exampleId: string;
  snippet: string;
  terms: string[];
  score: number;
}

export function retrieve(queryText: string, examples: Example[]): Ranked[] {
  const query = tokenize(queryText);
  if (!query.length || !examples.length) return [];

  const docs = examples.map((example) => ({ example, terms: tokenize(example.description) }));
  const idf = inverseDocumentFrequency(docs.map((d) => d.terms));

  const queryVector = vectorize(query, idf);
  if (!queryVector.size) return [];

  // ponytail: a plain scan over the whole corpus per query, rebuilding IDF each
  // call — fine for the few dozen examples a technician saves by hand; add an
  // index only if the corpus grows large enough for this to be measurably slow.
  const perService = new Map<string, { service: Example['service']; score: number; evidence: ScoredEvidence[] }>();

  for (const { example, terms } of docs) {
    const score = cosine(queryVector, vectorize(terms, idf));
    if (score <= 0) continue;

    const shared = [...new Set(terms.filter((t) => queryVector.has(t)))];
    const key = example.service.id;
    const entry = perService.get(key) ?? { service: example.service, score: 0, evidence: [] as ScoredEvidence[] };
    // A service is as strong as its best matching prior ticket. Averaging would
    // punish a service that has one perfect match and several unrelated ones.
    entry.score = Math.max(entry.score, score);
    entry.evidence.push({ exampleId: example.id, snippet: snippet(example.description), terms: shared, score });
    perService.set(key, entry);
  }

  return [...perService.values()]
    .map((entry) => ({
      service: entry.service,
      score: round(entry.score),
      evidence: entry.evidence
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ exampleId, snippet: s, terms }) => ({ exampleId, snippet: s, terms })),
    }))
    // Map insertion order (== corpus order) breaks ties deterministically —
    // Array#sort is stable, so equal scores keep whichever service was seen first.
    .sort((a, b) => b.score - a.score);
}

function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function inverseDocumentFrequency(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const terms of documents) {
    for (const term of new Set(terms)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const total = documents.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    // Smoothed so a term appearing in every example still contributes a little.
    idf.set(term, Math.log((total + 1) / (count + 0.5)) + 1);
  }
  return idf;
}

function vectorize(terms: string[], idf: Map<string, number>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const vector = new Map<string, number>();
  for (const [term, count] of counts) {
    const weight = idf.get(term);
    if (weight === undefined) continue; // a query word no example ever used
    vector.set(term, (1 + Math.log(count)) * weight);
  }
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [term, weight] of a) {
    const other = b.get(term);
    if (other) dot += weight * other;
  }
  if (!dot) return 0;
  return dot / (magnitude(a) * magnitude(b));
}

function magnitude(vector: Map<string, number>): number {
  let sum = 0;
  for (const weight of vector.values()) sum += weight * weight;
  // A zero vector never reaches this via cosine() (dot would already be 0 and
  // short-circuit), but guarding here keeps this helper safe to call alone.
  return Math.sqrt(sum) || 1;
}

function snippet(text: string): string {
  const plain = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 140 ? `${plain.slice(0, 137)}...` : plain;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
