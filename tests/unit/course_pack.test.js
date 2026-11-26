import assert from 'node:assert/strict';
import test from 'node:test';
import { coursePackSchema, parseCoursePack, parseCourseQuestions } from '../../code/core_engine/learning_agent/course-pack-schema.js';
import { coursePack, courseVersion, focusConceptId } from '../../code/core_engine/learning_agent/knowledge-data.js';
import { createCourseKnowledge } from '../../code/core_engine/learning_agent/knowledge.js';

const scope = { courseVersion, conceptId: focusConceptId };

function invalidPaths(candidate) {
  const result = coursePackSchema.safeParse(candidate);
  assert.equal(result.success, false);
  return result.error.issues.map(({ path }) => path.join('.'));
}

function questionsFixture() {
  const common = {
    ...scope, reviewStatus: 'pending', choices: [{ id: 'a', text: '一点的函数值' }, { id: 'b', text: '趋近时的值' }],
    answer: 'b', pointValue: 'a'
  };
  return {
    practice: { ...common, id: 'fixture-practice', prompt: '判断这道练习的极限。' },
    verification: { ...structuredClone(common), id: 'fixture-verification', prompt: '再判断一道变式题的极限。' }
  };
}

test('当前课包的版本、图谱和参考资料可通过模式校验，教学审阅保持待确认', () => {
  const parsed = parseCoursePack(coursePack);
  const knownSources = new Set(parsed.sources.map(source => source.id));
  assert.equal(parsed.courseVersion, courseVersion);
  assert.equal(parsed.focusConceptId, focusConceptId);
  assert.ok(parsed.passages.length > 0);
  assert.ok(parsed.passages.every(record => record.reviewStatus === 'pending' && knownSources.has(record.sourceId)));
});

test('重复的概念、出处及片段标识和悬空关系无法载入课包', () => {
  const candidate = structuredClone(coursePack);
  const duplicates = ['concepts', 'sources', 'passages'].map(field => `${field}.${candidate[field].length}.id`);
  candidate.concepts.push(candidate.concepts[0]);
  candidate.sources.push(candidate.sources[0]);
  candidate.passages.push(candidate.passages[0]);
  candidate.focusConceptId = 'unlisted-concept';
  candidate.relations[0].from = 'unlisted-start';
  candidate.relations[0].to = 'unlisted-end';
  const paths = invalidPaths(candidate);
  for (const expected of [...duplicates, 'focusConceptId', 'relations.0.from', 'relations.0.to']) {
    assert.ok(paths.includes(expected), expected);
  }
});

test('提示片段限制版本、概念、出处、等级、正文与发布状态', () => {
  const candidate = structuredClone(coursePack);
  Object.assign(candidate.passages[0], {
    id: 'outside-v2/wrong-passage', courseVersion: 'outside-v2', conceptId: 'unlisted-concept',
    sourceId: 'unlisted-source', level: 6, text: '   ', publicationStatus: 'unknown'
  });
  assert.deepEqual(invalidPaths(candidate).sort(), ['passages.0.level', 'passages.0.publicationStatus', 'passages.0.text']);
  Object.assign(candidate.passages[0], { level: 5, text: '待修订的材料', publicationStatus: 'published', reviewStatus: 'changes-requested' });
  assert.deepEqual(invalidPaths(candidate).sort(),
    ['passages.0.conceptId', 'passages.0.courseVersion', 'passages.0.reviewStatus', 'passages.0.sourceId']);
});

test('仅接受不含登录凭据的 HTTPS 教材出处', () => {
  const candidate = structuredClone(coursePack);
  for (const value of ['http://example.edu/section', 'https://student:secret@example.edu/section', '/section']) {
    candidate.sources[0].url = value;
    assert.ok(invalidPaths(candidate).includes('sources.0.url'));
  }
});

test('检索、引用复查及图谱仅公开已发布的课包内容', () => {
  const candidate = structuredClone(coursePack);
  const [draft, retired, published] = candidate.passages;
  draft.publicationStatus = 'draft';
  retired.publicationStatus = 'retired';
  const publishedIndex = createCourseKnowledge(candidate);
  const query = { ...scope, query: `${draft.terms[0]} ${retired.terms[0]} ${published.terms[0]}` };
  const results = publishedIndex.retrieveKnowledge(query).map(record => record.id);
  assert.ok(results.includes(published.id));
  for (const record of [draft, retired]) {
    assert.equal(results.includes(record.id), false);
    assert.equal(publishedIndex.lookupKnowledge({ id: record.id, courseVersion }), null);
  }
  assert.equal(publishedIndex.lookupKnowledge({ id: published.id, courseVersion }).citation.id, published.id);

  const draftIndex = createCourseKnowledge({ ...candidate, publicationStatus: 'draft' });
  assert.deepEqual(draftIndex.expandKnowledge(scope), []);
  assert.deepEqual(draftIndex.retrieveKnowledge(query), []);
  assert.equal(draftIndex.lookupKnowledge({ id: published.id, courseVersion }), null);
});

test('练习题和验证题各自关联课包，答案和误选须来自不同的合法选项', () => {
  const parsed = parseCourseQuestions(questionsFixture(), coursePack);
  assert.equal(parsed.practice.answer, 'b');
  const cases = [
    [questions => { questions.verification.id = questions.practice.id; }, /独立标识/],
    [questions => { questions.practice.choices[1].id = questions.practice.choices[0].id; }, /重复/],
    [questions => { questions.practice.answer = 'unknown'; }, /已声明的选项/],
    [questions => { questions.verification.pointValue = questions.verification.answer; }, /不同于答案/],
    [questions => { questions.verification.courseVersion = 'another-course-v3'; }, /不属于当前课包/],
    [questions => { questions.practice.conceptId = 'unknown'; }, /不属于当前课包/]
  ];
  for (const [mutate, expectation] of cases) {
    const candidate = questionsFixture();
    mutate(candidate);
    assert.throws(() => parseCourseQuestions(candidate, coursePack), expectation);
  }
});
