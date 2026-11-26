import { courseIdentifierSchema, parseCoursePack } from './course-pack-schema.js';
import { coursePack } from './knowledge-data.js';

export { courseVersion, focusConceptId } from './knowledge-data.js';

const queryLimit = 500;
const resultLimit = 5;
export const relatedConceptIdsSchema = courseIdentifierSchema.array();

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchesTerm(query, term) {
  if (/\p{Script=Han}/u.test(term)) return query.includes(term);
  return ` ${query} `.includes(` ${term} `);
}

function indexPassages(pack) {
  if (pack.publicationStatus !== 'published') return [];
  const sources = new Map(pack.sources.map(source => [source.id, source]));
  return pack.passages.filter(passage => passage.publicationStatus === 'published').map(passage => {
    const { label, url } = sources.get(passage.sourceId);
    const { id, courseVersion, section } = passage;
    return {
      passage: { ...passage, citation: { id, courseVersion, section, label, url } },
      terms: passage.terms.map(normalize)
    };
  });
}

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

function isCourseConcept(knowledge, conceptId, version) {
  return knowledge.publicationStatus === 'published'
    && version === knowledge.courseVersion && knowledge.conceptLabels.has(conceptId);
}

function expandCourse(knowledge, { conceptId, courseVersion: version } = {}) {
  if (!isCourseConcept(knowledge, conceptId, version)) return [];
  return knowledge.relations.filter(({ from }) => from === conceptId).map(({ to, kind }) => ({
    conceptId: to, label: knowledge.conceptLabels.get(to), relation: kind
  }));
}

function lookupCourse(knowledge, { id, courseVersion: version } = {}) {
  if (version !== knowledge.courseVersion) return null;
  const match = knowledge.searchIndex.find(({ passage }) => passage.id === id);
  return match ? publicPassage(match.passage) : null;
}

function normalizedQuery(query) {
  if (typeof query !== 'string' || query.length > queryLimit) return '';
  return normalize(query);
}

function validBounds(maxLevel, limit) {
  return Number.isInteger(maxLevel) && maxLevel >= 1 && maxLevel <= 5 &&
    Number.isInteger(limit) && limit >= 1;
}

function retrievalScope(knowledge, conceptId, version, relatedConceptIds) {
  let requested = null;
  if (relatedConceptIds !== undefined) {
    const parsed = relatedConceptIdsSchema.safeParse(relatedConceptIds);
    if (!parsed.success) return null;
    requested = new Set(parsed.data);
  }
  const scope = new Set([conceptId]);
  for (const { conceptId: neighborId } of expandCourse(knowledge, { conceptId, courseVersion: version })) {
    if (requested === null || requested.has(neighborId)) scope.add(neighborId);
  }
  return scope;
}

function retrieveCourse(knowledge, { query, conceptId, courseVersion: version, limit = 3, maxLevel = 5, relatedConceptIds } = {}) {
  const normalized = normalizedQuery(query);
  if (!isCourseConcept(knowledge, conceptId, version) || !normalized || !validBounds(maxLevel, limit)) return [];
  const scope = retrievalScope(knowledge, conceptId, version, relatedConceptIds);
  if (!scope) return [];
  const matches = knowledge.searchIndex.filter(({ passage }) => scope.has(passage.conceptId) && passage.level <= maxLevel)
    .map(({ passage, terms }) => ({ passage, score: rankMatch(normalized, terms) }))
    .filter(({ score }) => score > 0);

  // Stable sort keeps the course order when passages have the same lexical score.
  return matches.sort((a, b) => b.score - a.score || b.passage.level - a.passage.level)
    .slice(0, Math.min(limit, resultLimit)).map(({ passage }) => publicPassage(passage));
}

export function createCourseKnowledge(value) {
  const pack = parseCoursePack(value);
  const knowledge = {
    courseVersion: pack.courseVersion, publicationStatus: pack.publicationStatus, relations: pack.relations,
    conceptLabels: new Map(pack.concepts.map(({ id, label }) => [id, label])), searchIndex: indexPassages(pack)
  };
  return {
    expandKnowledge: query => expandCourse(knowledge, query),
    lookupKnowledge: query => lookupCourse(knowledge, query),
    retrieveKnowledge: query => retrieveCourse(knowledge, query)
  };
}

export const { expandKnowledge, lookupKnowledge, retrieveKnowledge } = createCourseKnowledge(coursePack);
