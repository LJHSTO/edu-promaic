import assert from 'node:assert/strict';
import test from 'node:test';
import {
  courseVersion, expandKnowledge, focusConceptId, lookupKnowledge, retrieveKnowledge
} from '../../code/core_engine/learning_agent/knowledge.js';

const focus = { conceptId: focusConceptId, courseVersion };
const id = key => `${courseVersion}/${key}`;

test('课前线索检索按相关术语匹配课程段落和图谱邻接概念', () => {
  const cases = [
    ['先让我说说观察依据', 'compare-observations'],
    ['从哪里看正确的趋势', 'compare-observations'],
    ['用自我解释的方法', 'compare-observations'],
    ['点上还是附近要看哪边', 'compare-observations'],
    ['怎么区分点值与附近趋势', 'limit-versus-value'],
    ['移除目标点后改变附近趋势吗', 'limit-versus-value'],
    ['函数值就是自变量趋近时得到的吗', 'limit-versus-value'],
    ['图上的空心点与实心点', 'punctured-neighborhood'],
    ['去心邻域的取值条件', 'punctured-neighborhood'],
    ['不等于目标点时该看哪里', 'punctured-neighborhood'],
    ['左右极限相同才有双侧极限吗', 'two-sided-criterion'],
    ['从一侧趋近', 'two-sided-criterion'],
    ['怎样用数值表观察', 'nearby-table'],
    ['靠近时能否用列表估计', 'nearby-table'],
    ['怎样因式分解并约去公因式', 'factor-and-cancel'],
    ['约分时分母不为零', 'factor-and-cancel'],
    ['可否给一个类似例题', 'nearby-equivalence-example'],
    ['来一个类比例子', 'nearby-equivalence-example'],
    ['如何判断连续', 'continuity-criteria'],
    ['在一点连续的连续条件是什么', 'continuity-criteria']
  ];
  for (const [query, expected] of cases) {
    assert.equal(retrieveKnowledge({ ...focus, query })[0]?.id, id(expected), query);
  }
});

test('英文查询词接受大小写、全角和连字符，并按完整词匹配', () => {
  const sided = retrieveKnowledge({ ...focus, query: 'What is the ONE-SIDED LIMIT?' });
  const example = retrieveKnowledge({ ...focus, query: 'ＷＯＲＫＥＤ－ＥＸＡＭＰＬＥ' });
  assert.equal(sided[0]?.id, id('two-sided-criterion'));
  assert.equal(example[0]?.id, id('nearby-equivalence-example'));
  assert.deepEqual(retrieveKnowledge({ ...focus, query: 'discontinuity' }), []);
});

test('知识图谱携带关系，检索只展开当前概念的一跳邻居', () => {
  assert.deepEqual(expandKnowledge(focus), [
    { conceptId: 'sided-limits', label: '左右极限', relation: 'checked-from-both-sides' },
    { conceptId: 'equivalent-nearby-expressions', label: '邻域内等价的表达式', relation: 'computed-in-neighborhood' },
    { conceptId: 'continuity', label: '一点处的连续性', relation: 'compared-for-continuity' }
  ]);
  assert.deepEqual(retrieveKnowledge({ ...focus, query: '可去间断与补点' }), []);
  const neighboringScope = { ...focus, conceptId: 'continuity', query: '可去间断与补点' };
  assert.equal(retrieveKnowledge(neighboringScope)[0]?.id, id('removable-extension'));
  assert.deepEqual(expandKnowledge({ ...focus, courseVersion: 'unpublished' }), []);
});

test('提示等级和检索条数约束候选，等分时返回顺序稳定', () => {
  const query = '观察依据 区分点值 取值条件 约去公因式 类比例子 左右极限 数值表 连续性';
  assert.equal(retrieveKnowledge({ ...focus, query, limit: 99 }).length, 5);
  const firstLevel = retrieveKnowledge({ ...focus, query, maxLevel: 1 });
  assert.equal(firstLevel.length, 1);
  assert.equal(firstLevel[0].level, 1);
  const secondLevel = { ...focus, query, maxLevel: 2, limit: 2 };
  const firstRun = retrieveKnowledge(secondLevel);
  assert.equal(firstRun.length, 2);
  assert.ok(firstRun.every(passage => passage.level <= 2));
  assert.deepEqual(retrieveKnowledge(secondLevel), firstRun);
  assert.deepEqual(retrieveKnowledge({ ...focus, query, maxLevel: 0 }), []);
  assert.deepEqual(retrieveKnowledge({ ...focus, query, limit: -1 }), []);
});

test('跨课包、域外、空白及超长查询返回无检索证据', () => {
  assert.deepEqual(retrieveKnowledge({ ...focus, courseVersion: 'lesson-v2', query: '点值' }), []);
  assert.deepEqual(retrieveKnowledge({ ...focus, conceptId: 'unknown', query: '点值' }), []);
  for (const query of ['', '？！', '排列组合概率', '天气预报', 'x'.repeat(501), undefined]) {
    assert.deepEqual(retrieveKnowledge({ ...focus, query }), []);
  }
});

test('引用按课程版本回链到批准材料，调用方修改结果不污染知识库', () => {
  const [passage] = retrieveKnowledge({ ...focus, query: '因式分解', limit: 1 });
  assert.equal(passage.citation.id, passage.id);
  assert.equal(passage.citation.courseVersion, courseVersion);
  assert.equal(passage.citation.section, '因式分解与约分求极限');
  assert.equal(new URL(passage.citation.url).hostname, 'openstax.org');
  assert.equal('terms' in passage, false);
  const citation = { ...passage.citation };
  passage.citation.url = 'https://example.invalid/';
  assert.deepEqual(lookupKnowledge({ id: passage.id, courseVersion }).citation, citation);
  assert.equal(lookupKnowledge({ id: passage.id, courseVersion: 'unpublished' }), null);
  assert.equal(lookupKnowledge({ id: 'nonexistent', courseVersion }), null);
});
