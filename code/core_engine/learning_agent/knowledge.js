import { conceptLabels, conceptRelations, courseVersion, passages } from './knowledge-data.js';

export { courseVersion, focusConceptId } from './knowledge-data.js';

const queryLimit = 500;
const resultLimit = 5;

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchesTerm(query, term) {
  if (/\p{Script=Han}/u.test(term)) return query.includes(term);
  return ` ${query} `.includes(` ${term} `);
}

const searchIndex = passages.map(passage => ({
  passage, terms: passage.terms.map(normalize)
}));

function rankMatch(query, terms) {
  let score = 0;
  for (const term of terms) {
    if (matchesTerm(query, term)) score += 2 + Math.min(term.length, 8);
  }
  return score;
}

function publicPassage({ id, conceptId, text, level, citation }) {
  return { id, conceptId, text, level, citation: { ...citation } };
}

function isCourseConcept(conceptId, version) {
  return version === courseVersion && conceptLabels.has(conceptId);
}

export function expandKnowledge({ conceptId, courseVersion: version } = {}) {
  if (!isCourseConcept(conceptId, version)) return [];
  return conceptRelations.filter(([from]) => from === conceptId).map(([, neighbor, relation]) => ({
    conceptId: neighbor, label: conceptLabels.get(neighbor), relation
  }));
}

export function lookupKnowledge({ id, courseVersion: version } = {}) {
  if (version !== courseVersion) return null;
  const found = passages.find(passage => passage.id === id);
  return found ? publicPassage(found) : null;
}

function normalizedQuery(query) {
  if (typeof query !== 'string' || query.length > queryLimit) return '';
  return normalize(query);
}

function validBounds(maxLevel, limit) {
  return Number.isInteger(maxLevel) && maxLevel >= 1 && maxLevel <= 5 &&
    Number.isInteger(limit) && limit >= 1;
}

export function retrieveKnowledge({ query, conceptId, courseVersion: version, limit = 3, maxLevel = 5 } = {}) {
  const normalized = normalizedQuery(query);
  if (!isCourseConcept(conceptId, version) || !normalized || !validBounds(maxLevel, limit)) return [];
  const neighbors = expandKnowledge({ conceptId, courseVersion: version });
  const scope = new Set([conceptId, ...neighbors.map(neighbor => neighbor.conceptId)]);
  const matches = searchIndex.filter(({ passage }) => scope.has(passage.conceptId) && passage.level <= maxLevel)
    .map(({ passage, terms }) => ({ passage, score: rankMatch(normalized, terms) }))
    .filter(({ score }) => score > 0);

  // Stable sort keeps the course order when passages have the same lexical score.
  return matches.sort((a, b) => b.score - a.score || b.passage.level - a.passage.level)
    .slice(0, Math.min(limit, resultLimit)).map(({ passage }) => publicPassage(passage));
}
