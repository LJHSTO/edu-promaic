import { URL } from 'node:url';
import { z } from 'zod';

const identifier = z.string().max(100).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export { identifier as courseIdentifierSchema };
const version = z.string().max(100).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-v[1-9][0-9]*$/);
const passageIdentifier = z.string().max(201).regex(/^[a-z][a-z0-9-]+\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const authoredText = z.string().trim().min(1);
const publicationStatus = z.enum(['draft', 'published', 'retired']);
const reviewStatus = z.enum(['pending', 'approved', 'changes-requested']);

const sourceUrl = z.url({ protocol: /^https$/ }).refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password;
}, '教材出处不得包含访问凭据。');

const concept = z.strictObject({ id: identifier, label: authoredText });
const source = z.strictObject({ id: identifier, label: authoredText, url: sourceUrl });
const relation = z.strictObject({ from: identifier, to: identifier, kind: identifier });
const passage = z.strictObject({
  id: passageIdentifier, courseVersion: version, conceptId: identifier, sourceId: identifier,
  section: authoredText, level: z.number().int().min(1).max(5), terms: z.array(authoredText).min(1),
  text: authoredText, publicationStatus, reviewStatus
});

function issue(context, path, message) {
  context.addIssue({ code: 'custom', path, message });
}

function collectIds(records, field, context) {
  const ids = new Set();
  for (const [index, { id }] of records.entries()) {
    if (ids.has(id)) issue(context, [field, index, 'id'], `标识 ${id} 重复。`);
    ids.add(id);
  }
  return ids;
}

function validateRelations(relations, conceptIds, context) {
  for (const [index, { from, to }] of relations.entries()) {
    if (!conceptIds.has(from)) issue(context, ['relations', index, 'from'], '概念关系的起点不在当前课包。');
    if (!conceptIds.has(to)) issue(context, ['relations', index, 'to'], '概念关系的终点不在当前课包。');
    if (from === to) issue(context, ['relations', index, 'to'], '概念关系须连接两个不同的概念。');
  }
}

function validatePassages(pack, conceptIds, sourceIds, context) {
  for (const [index, record] of pack.passages.entries()) {
    const path = ['passages', index];
    if (record.courseVersion !== pack.courseVersion || !record.id.startsWith(`${pack.courseVersion}/`)) {
      issue(context, [...path, 'courseVersion'], '提示片段的版本及标识须属于当前课包。');
    }
    if (!conceptIds.has(record.conceptId)) issue(context, [...path, 'conceptId'], '提示片段引用了未知概念。');
    if (!sourceIds.has(record.sourceId)) issue(context, [...path, 'sourceId'], '提示片段引用了未知出处。');
    if (record.publicationStatus === 'published' && record.reviewStatus === 'changes-requested') {
      issue(context, [...path, 'reviewStatus'], '待修改的提示片段须撤出发布范围。');
    }
  }
}

export const coursePackSchema = z.strictObject({
  courseVersion: version, focusConceptId: identifier, publicationStatus,
  concepts: z.array(concept).min(1), relations: z.array(relation), sources: z.array(source).min(1), passages: z.array(passage)
}).superRefine((pack, context) => {
  const conceptIds = collectIds(pack.concepts, 'concepts', context);
  const sourceIds = collectIds(pack.sources, 'sources', context);
  collectIds(pack.passages, 'passages', context);
  if (!conceptIds.has(pack.focusConceptId)) issue(context, ['focusConceptId'], '课程重点须属于当前课包。');
  validateRelations(pack.relations, conceptIds, context);
  validatePassages(pack, conceptIds, sourceIds, context);
});

export function parseCoursePack(value) {
  return coursePackSchema.parse(value);
}

const choice = z.strictObject({ id: identifier, text: authoredText });
const question = z.strictObject({
  id: identifier, courseVersion: version, conceptId: identifier, reviewStatus, prompt: authoredText,
  choices: z.array(choice).min(2), answer: identifier, pointValue: identifier.optional()
}).superRefine((record, context) => {
  const choices = collectIds(record.choices, 'choices', context);
  if (!choices.has(record.answer)) issue(context, ['answer'], '答案须对应已声明的选项。');
  if (record.pointValue !== undefined && (!choices.has(record.pointValue) || record.pointValue === record.answer)) {
    issue(context, ['pointValue'], '误选标记须对应不同于答案的已声明选项。');
  }
});

export const courseQuestionsSchema = z.strictObject({ practice: question, verification: question }).superRefine((records, context) => {
  if (records.practice.id === records.verification.id) issue(context, ['verification', 'id'], '练习题与验证题须有独立标识。');
});

export function parseCourseQuestions(value, pack) {
  const questions = courseQuestionsSchema.parse(value);
  const conceptIds = new Set(pack.concepts.map(({ id }) => id));
  for (const [phase, record] of Object.entries(questions)) {
    if (record.courseVersion !== pack.courseVersion || !conceptIds.has(record.conceptId)) {
      throw new Error(`课堂题目 ${phase} 的版本或概念不属于当前课包。`);
    }
  }
  return questions;
}
