import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveDecisionEngine } from '../../code/core_engine/index.js';

const engine = new ActiveDecisionEngine();

test('无错误的长停顿及首次误解不单独触发提示', () => {
  for (const context of [
    {}, { pauseSeconds: 100 },
    { consecutiveErrors: 1, misconceptionType: 'limit_equals_function_value' }
  ]) {
    assert.equal(engine.evaluate(context).action, 'SILENCE');
  }
});

test('阈值边界：两次错误首次提示为 L1，下一次从当前等级递进', () => {
  assert.equal(engine.evaluate({ consecutiveErrors: 2 }).level, 1);
  assert.equal(engine.evaluate({ consecutiveErrors: 3, currentLevel: 1 }).level, 2);
  assert.equal(engine.evaluate({ consecutiveErrors: 10, currentLevel: 5 }).level, 5);
});

test('保护阶段优先于关闭、错误、求助和所有等级', () => {
  for (let currentLevel = 0; currentLevel <= 5; currentLevel++) {
    const result = engine.evaluate({
      inProtectedAssessment: true, requestedHelp: true, userOptedOut: true,
      consecutiveErrors: 10, pauseSeconds: 120, currentLevel
    });
    assert.equal(result.action, 'SILENCE');
    assert.equal(result.level, 0);
    assert.equal(result.reasonCode, 'PROTECTED_ASSESSMENT');
  }
});

test('已关闭提示时主动求助也不能绕过开关', () => {
  assert.equal(engine.evaluate({
    userOptedOut: true, requestedHelp: true, consecutiveErrors: 10
  }).reasonCode, 'USER_OPTED_OUT');
});

test('有效输入抑制自动提示，显式求助允许给出线索', () => {
  assert.equal(engine.evaluate({ isActivelyWorking: true, consecutiveErrors: 2 }).action, 'SILENCE');
  assert.equal(engine.evaluate({ isActivelyWorking: true, requestedHelp: true }).level, 1);
});

test('主动预算与冷却边界', () => {
  assert.equal(engine.evaluate({ consecutiveErrors: 2, interventionsUsed: 2 }).reasonCode, 'BUDGET_EXHAUSTED');
  assert.equal(engine.evaluate({ consecutiveErrors: 2, secondsSinceLastIntervention: 59 }).reasonCode, 'COOLDOWN');
  assert.equal(engine.evaluate({ consecutiveErrors: 2, secondsSinceLastIntervention: 60 }).action, 'INTERVENE');
});

test('学生求助不受主动预算与冷却限制，等级不超过 L5', () => {
  for (let currentLevel = 0; currentLevel <= 5; currentLevel++) {
    const result = engine.evaluate({
      requestedHelp: true, currentLevel, interventionsUsed: 2, secondsSinceLastIntervention: 0
    });
    assert.equal(result.action, 'INTERVENE');
    assert.equal(result.level, Math.min(currentLevel + 1, 5));
  }
});

test('合法的零预算与零冷却配置不会被默认值覆盖', () => {
  const noAutomaticHelp = new ActiveDecisionEngine({ maxProactiveInterventions: 0 });
  assert.equal(noAutomaticHelp.evaluate({ consecutiveErrors: 2 }).action, 'SILENCE');
  const noCooldown = new ActiveDecisionEngine({ silenceCooldownSec: 0, errorThreshold: 3 });
  assert.equal(noCooldown.evaluate({ consecutiveErrors: 2 }).action, 'SILENCE');
  assert.equal(noCooldown.evaluate({ consecutiveErrors: 3, secondsSinceLastIntervention: 0 }).level, 1);
});

test('非法上下文和值不能被隐式转换', () => {
  for (const context of [
    null, [], 'text', { consecutiveErrors: -1 }, { consecutiveErrors: 1.5 },
    { userOptedOut: 'false' }, { inProtectedAssessment: 0 }, { pauseSeconds: NaN },
    { pauseSeconds: Infinity }, { currentLevel: 6 }, { currentLevel: null },
    { interventionsUsed: -1 }, { secondsSinceLastIntervention: -1 },
    { misconceptionType: {} }, { misconceptionType: 'a'.repeat(101) }
  ]) {
    assert.throws(() => engine.evaluate(context), TypeError);
  }
});

test('非法阈值配置被拒绝', () => {
  for (const options of [
    { errorThreshold: 0 }, { errorThreshold: 1.5 }, { silenceCooldownSec: -1 },
    { maxProactiveInterventions: '2' }, { pauseDurationThresholdSec: NaN }
  ]) {
    assert.throws(() => new ActiveDecisionEngine(options), TypeError);
  }
});

test('评估不会修改调用方上下文', () => {
  const context = Object.freeze({ consecutiveErrors: 2, currentLevel: 0 });
  assert.deepEqual(engine.evaluate(context), engine.evaluate(context));
  assert.deepEqual(context, { consecutiveErrors: 2, currentLevel: 0 });
});