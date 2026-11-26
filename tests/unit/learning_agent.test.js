import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveDecisionEngine } from '../../code/core_engine/index.js';
import { createLearningAgent } from '../../code/core_engine/learning_agent/agent.js';
import { projectLearningMemory } from '../../code/core_engine/learning_agent/memory.js';
import { courseVersion, focusConceptId, lookupKnowledge } from '../../code/core_engine/learning_agent/knowledge.js';
import { createModelPlanner } from '../../code/backend/model-planner.js';

const misconception = 'limit_equals_function_value';
const sidedLimits = { conceptId: 'sided-limits', label: '左右极限' };
const nearbyExpressions = { conceptId: 'equivalent-nearby-expressions', label: '邻域内等价的表达式' };
const fallback = level => ({ level, text: '教学备用线索', source: { label: '课程说明' } });
const build = options => createLearningAgent({ engine: new ActiveDecisionEngine(), approvedFallback: fallback, ...options });

function input({ phase = 'practice', helpEnabled = true, memory = projectLearningMemory([]), ...decisionContext } = {}) {
  return { phase, helpEnabled, memory, courseVersion, decisionContext };
}

function tool(name, invoke = () => { throw new Error('tool unavailable'); }) {
  return { name, invoke };
}

test('保护期和关闭状态在读取图谱及调用工具前停止', async () => {
  let calls = 0;
  const expand = tool('expand', () => { calls++; });
  const agent = build({ tools: { expand } });
  for (const [options, reason] of [
    [{ phase: 'verification' }, 'PROTECTED_ASSESSMENT'],
    [{ helpEnabled: false }, 'USER_OPTED_OUT']
  ]) {
    const result = await agent(input({ ...options, requestedHelp: true }));
    assert.equal(result.hint, null);
    assert.equal(result.trace.outcome, 'blocked');
    assert.equal(result.trace.reason, reason);
    assert.equal(result.trace.policyReason, null);
    assert.deepEqual(result.trace.steps, ['guard']);
    assert.deepEqual(result.trace.tools, []);
  }
  assert.equal(calls, 0);
});

test('真实状态图使用已发布引用和独立数值工具', async () => {
  const result = await build()(input({ requestedHelp: true, currentLevel: 3 }));
  const { hint, trace } = result;
  assert.equal(trace.outcome, 'grounded');
  assert.equal(trace.reason, 'REQUESTED_HELP');
  assert.equal(trace.policyReason, trace.reason);
  assert.equal(hint.level, 4);
  assert.equal(hint.citations[0].courseVersion, courseVersion);
  assert.deepEqual(hint.example.nearby.slice(2), [[-0.01, 9.99], [0.01, 10.01]]);
  assert.deepEqual(trace.tools, ['expand_course_concept', 'retrieve_course_passages', 'compare_point_neighborhood']);
  assert.deepEqual(trace.sourceIds, [hint.citations[0].id]);
});

test('会话记忆在同一提示等级优先选用近期未引用的候选', async () => {
  const ids = ['punctured-neighborhood', 'nearby-domain-check'].map(key => `${courseVersion}/${key}`);
  const passages = ids.map(id => lookupKnowledge({ id, courseVersion }));
  const expand = tool('expand', () => [nearbyExpressions]);
  const search = tool('search', ({ maxLevel }) => {
    assert.equal(maxLevel, 3);
    return passages;
  });
  const agent = build({ tools: { expand, search } });
  const firstHint = await agent(input({ requestedHelp: true, currentLevel: 2 }));
  const memory = projectLearningMemory([{ phase: 'practice', agent: firstHint.trace }]);
  const next = await agent(input({ requestedHelp: true, currentLevel: 2, memory }));
  assert.equal(firstHint.hint.level, next.hint.level);
  assert.equal(next.trace.memory.avoidedSources, 1);
  assert.deepEqual(firstHint.trace.sourceIds, [ids[0]]);
  assert.deepEqual(next.trace.sourceIds, [ids[1]]);
});

test('会话记忆只看最近 16 个事件及最近 6 个不同来源', () => {
  const sourceEvent = id => ({ phase: 'practice', agent: { sourceIds: [id] } });
  const history = [
    { ...sourceEvent('expired'), misconception },
    { ...sourceEvent('within-window'), misconception },
    { phase: 'verification', misconception },
    ...Array.from({ length: 7 }, (_, index) => sourceEvent(`recent-${index + 1}`)),
    ...Array.from({ length: 6 }, () => ({ phase: 'practice' })),
    sourceEvent('recent-4')
  ];
  assert.deepEqual(projectLearningMemory(history, misconception), {
    misconception, pointValueErrors: 2,
    seenSourceIds: ['recent-4', 'recent-7', 'recent-6', 'recent-5', 'recent-3', 'recent-2']
  });
  assert.equal(projectLearningMemory([...history, { phase: 'practice' }]).misconception, null);
});

test('主检索无匹配时按图谱邻接概念补查一次，无证据时提供固定提示', async () => {
  const queries = [];
  const expand = tool('expand', () => [sidedLimits, nearbyExpressions]);
  const search = tool('search', request => { queries.push(request); return []; });
  const result = await build({ tools: { expand, search } })(input({ requestedHelp: true }));
  assert.equal(queries.length, 2);
  assert.equal(queries[0].conceptId, focusConceptId);
  assert.deepEqual(queries[0].relatedConceptIds, [sidedLimits.conceptId, nearbyExpressions.conceptId]);
  assert.equal(queries[1].query, sidedLimits.label);
  assert.deepEqual(queries[1].relatedConceptIds, [sidedLimits.conceptId]);
  assert.equal(result.trace.outcome, 'fallback');
  assert.equal(result.trace.reason, 'NO_APPROVED_PASSAGE');
  assert.equal(result.trace.policyReason, 'REQUESTED_HELP');
  assert.deepEqual(result.trace.sourceIds, []);
  assert.equal(result.hint.text, '教学备用线索');
});

test('补查失败记录真实步骤和检索原因，保留政策触发原因', async () => {
  const expand = tool('expand', () => [sidedLimits]);
  const search = tool('search', ({ query }) => {
    if (query === '左右极限') throw new Error('课程检索暂不可用');
    return [];
  });
  const { hint, trace } = await build({ tools: { expand, search } })(input({ consecutiveErrors: 2 }));
  assert.equal(hint.text, '教学备用线索');
  assert.deepEqual(trace.steps.slice(-3), ['retrieve', 'retrieve-related', 'fallback']);
  assert.equal(trace.reason, 'KNOWLEDGE_UNAVAILABLE');
  assert.equal(trace.policyReason, 'REPEATED_ERRORS');
});

test('编排拒绝图谱范围外的真实课包片段，不会交给模型或显示引用', async () => {
  const outsideId = `${courseVersion}/removable-extension`;
  const distant = lookupKnowledge({ id: outsideId, courseVersion });
  const expand = tool('expand', () => [sidedLimits, { conceptId: distant.conceptId, label: '可去间断' }]);
  let offered;
  const planner = ({ passages }) => {
    offered = passages.map(passage => passage.id);
    return outsideId;
  };
  const query = input({ requestedHelp: true, currentLevel: 2 });
  const noMatch = tool('search', () => [distant]);
  const result = await build({ tools: { expand, search: noMatch }, planner })(query);
  assert.equal(result.trace.outcome, 'fallback');
  assert.equal(result.trace.reason, 'CITATION_REJECTED');
  assert.deepEqual(result.trace.sourceIds, []);
  assert.equal(result.hint.text, '教学备用线索');
  assert.equal(offered, undefined);

  const retainedIds = ['punctured-neighborhood', 'two-sided-criterion'].map(key => `${courseVersion}/${key}`);
  const retained = retainedIds.map(id => lookupKnowledge({ id, courseVersion }));
  let requestedScope;
  const mixed = tool('search', request => {
    requestedScope = request.relatedConceptIds;
    return [distant, ...retained];
  });
  const grounded = await build({ tools: { expand, search: mixed }, planner })(query);
  assert.deepEqual(requestedScope, [sidedLimits.conceptId]);
  assert.deepEqual(offered, retainedIds);
  assert.deepEqual(grounded.trace.sourceIds, [retainedIds[0]]);
});

test('检索结果缺字段或未命中审核材料时不能直接展示', async () => {
  const expand = tool('expand', () => []);
  const search = tool('search', () => [null, { id: 'other-course/passage', text: '候选外输出' }]);
  const result = await build({ tools: { expand, search } })(input({ requestedHelp: true }));
  assert.equal(result.trace.outcome, 'fallback');
  assert.equal(result.trace.reason, 'CITATION_REJECTED');
  assert.equal(result.trace.policyReason, 'REQUESTED_HELP');
  assert.equal(result.hint.text, '教学备用线索');
});

test('模型只能从通过校验的候选中选一个，返回其他 ID 时用本地排序', async () => {
  let called = 0;
  const planner = async ({ passages }) => {
    called++;
    assert.ok(passages.every(passage => lookupKnowledge({ id: passage.id, courseVersion })));
    return 'outside-review-scope';
  };
  const result = await build({ planner })(input({ requestedHelp: true, currentLevel: 2 }));
  assert.equal(called, 1);
  assert.deepEqual(result.trace.steps.filter(step => step.startsWith('model') || step.startsWith('rank')),
    ['model-rank', 'rank-locally']);
  assert.equal(result.trace.outcome, 'grounded');
});

test('模型选择不同的已发布候选时，显示服务端组合的正文和对应引用', async () => {
  const chosen = `${courseVersion}/nearby-domain-check`;
  const agent = build({ planner: async ({ passages }) => {
    assert.ok(passages.some(passage => passage.id === chosen));
    return chosen;
  } });
  const result = await agent(input({ requestedHelp: true, currentLevel: 2 }));
  assert.equal(result.hint.citations[0].id, chosen);
  assert.match(result.hint.text, /在这些自变量上取值相同/);
  assert.ok(result.trace.steps.includes('model-rank'));
});

test('模型适配器只发送层级和公开材料，解析完整的结构化选择', async () => {
  const fetcher = async (url, request) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    assert.deepEqual(JSON.parse(body.messages[1].content), { level: 2, passages: [{ id: 'p1', text: '教材片段' }] });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"passageId":"p1"}' } }] });
  };
  const planner = createModelPlanner({ apiKey: 'fixture-value', model: 'deepseek-flash', fetcher });
  const choice = await planner({ level: 2, passages: [{ id: 'p1', text: '教材片段', ignored: 'fixture' }] });
  assert.equal(choice, 'p1');
});

test('模型适配器拒绝失败、截断和超出字节上限的供应响应', async () => {
  assert.equal(createModelPlanner(), undefined);
  assert.throws(() => createModelPlanner({ model: 'deepseek-flash' }), /同时配置/);
  const responses = [
    [new Response('暂不可用', { status: 503 }), /模型暂时不可用/],
    [Response.json({ choices: [{ finish_reason: 'length' }] }), /未返回完整/],
    [Response.json({ choices: [{ finish_reason: 'stop', message: { content: '  ' } }] }), SyntaxError],
    [Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }), /选择格式无效/],
    [new Response(' '.repeat(33 * 1024)), /响应过长/]
  ];
  for (const [response, message] of responses) {
    const planner = createModelPlanner({ apiKey: 'fixture-value', model: 'deepseek-flash', fetcher: async () => response });
    await assert.rejects(planner({ level: 3, passages: [] }), message);
  }
});

test('模型请求到期确实取消，工作流回到确定性选材', async () => {
  let reason;
  const fetcher = (url, { signal }) => new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => reject(new Error('超时信号未发出')), 1000);
    signal.addEventListener('abort', () => {
      clearTimeout(watchdog);
      reason = signal.reason;
      reject(reason);
    }, { once: true });
  });
  const planner = createModelPlanner({ apiKey: 'fixture-value', model: 'deepseek-flash', fetcher, timeout: 10 });
  const result = await build({ planner })(input({ requestedHelp: true, currentLevel: 2 }));
  assert.equal(reason?.name, 'TimeoutError');
  assert.equal(result.trace.outcome, 'grounded');
  assert.ok(result.trace.steps.includes('rank-locally'));
});
