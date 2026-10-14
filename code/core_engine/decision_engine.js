export const ScaffoldingLevel = Object.freeze({
  SILENCE: 0,
  SELF_EXPLANATION: 1,
  CONCEPT_HINT: 2,
  TASK_DECOMPOSITION: 3,
  NEXT_STEP_GUIDE: 4,
  PARTIAL_EXAMPLE: 5
});

function nonnegativeNumber(value, field, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      (integer && !Number.isInteger(value))) {
    throw new TypeError(`${field} 必须是非负${integer ? '整数' : '数值'}。`);
  }
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('请求上下文必须是 JSON 对象。');
  }
  const normalized = {
    consecutiveErrors: 0,
    pauseSeconds: 0,
    inProtectedAssessment: false,
    userOptedOut: false,
    isActivelyWorking: false,
    requestedHelp: false,
    interventionsUsed: 0,
    secondsSinceLastIntervention: null,
    currentLevel: 0,
    misconceptionType: null,
    ...context
  };
  for (const field of ['consecutiveErrors', 'interventionsUsed', 'currentLevel']) {
    nonnegativeNumber(normalized[field], field, true);
  }
  nonnegativeNumber(normalized.pauseSeconds, 'pauseSeconds');
  if (normalized.secondsSinceLastIntervention !== null) {
    nonnegativeNumber(normalized.secondsSinceLastIntervention, 'secondsSinceLastIntervention');
  }
  for (const field of ['inProtectedAssessment', 'userOptedOut', 'isActivelyWorking', 'requestedHelp']) {
    if (typeof normalized[field] !== 'boolean') {
      throw new TypeError(`${field} 必须是布尔值。`);
    }
  }
  if (normalized.currentLevel > ScaffoldingLevel.PARTIAL_EXAMPLE) {
    throw new TypeError('currentLevel 必须在 0 到 5 之间。');
  }
  if (normalized.misconceptionType !== null &&
      (typeof normalized.misconceptionType !== 'string' || normalized.misconceptionType.length > 100)) {
    throw new TypeError('misconceptionType 必须是至多 100 字符的字符串或 null。');
  }
  return normalized;
}

function decision(action, level, reasonCode, reason) {
  return { action, level, reasonCode, reason };
}

const silence = (code, reason) => decision('SILENCE', ScaffoldingLevel.SILENCE, code, reason);

export class ActiveDecisionEngine {
  constructor(options = {}) {
    this.errorThreshold = options.errorThreshold ?? 2;
    this.pauseDurationThresholdSec = options.pauseDurationThresholdSec ?? 45;
    this.maxProactiveInterventions = options.maxProactiveInterventions ?? 2;
    this.silenceCooldownSec = options.silenceCooldownSec ?? 60;
    nonnegativeNumber(this.errorThreshold, 'errorThreshold', true);
    if (this.errorThreshold === 0) throw new TypeError('errorThreshold 必须大于 0。');
    nonnegativeNumber(this.pauseDurationThresholdSec, 'pauseDurationThresholdSec');
    nonnegativeNumber(this.maxProactiveInterventions, 'maxProactiveInterventions', true);
    nonnegativeNumber(this.silenceCooldownSec, 'silenceCooldownSec');
  }

  // 单题计数与时间由调用方保存；引擎只计算，不修改上下文。
  evaluate(context = {}) {
    const state = normalizeContext(context);
    if (state.inProtectedAssessment) {
      return silence('PROTECTED_ASSESSMENT', '正在独立验证，暂不提供提示。');
    }
    if (state.userOptedOut) {
      return silence('USER_OPTED_OUT', '已关闭本题提示。');
    }
    if (state.isActivelyWorking && !state.requestedHelp) {
      return silence('ACTIVE_WORK', '正在作答，继续观察。');
    }
    if (state.requestedHelp) {
      return decision('INTERVENE', Math.min(state.currentLevel + 1, 5),
        'REQUESTED_HELP', '按你的请求提供下一层线索。');
    }
    if (state.interventionsUsed >= this.maxProactiveInterventions) {
      return silence('BUDGET_EXHAUSTED', '本题主动提示次数已用完。');
    }
    if (state.secondsSinceLastIntervention !== null &&
        state.secondsSinceLastIntervention < this.silenceCooldownSec) {
      return silence('COOLDOWN', '留出独立尝试的时间，暂不追加提示。');
    }
    if (state.consecutiveErrors >= this.errorThreshold) {
      return decision('INTERVENE', Math.min(state.currentLevel + 1, 5),
        'REPEATED_ERRORS', state.currentLevel === 0
          ? '连续错误达到阈值，先从自我解释开始。'
          : '仍有连续错误，提供下一层线索。');
    }
    if (state.pauseSeconds >= this.pauseDurationThresholdSec) {
      return silence('INSUFFICIENT_EVIDENCE', '停顿不足以判断遇到困难，继续观察。');
    }
    return silence('OBSERVE', '继续独立尝试。');
  }
}