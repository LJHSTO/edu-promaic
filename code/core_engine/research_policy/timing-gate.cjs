"use strict";

/**
 * @file timing-gate.js
 * @description D2 教学时机与沉默门控器
 * 主策略调用的时机契约：区分帮助需求与可打断性；只能否决，不能绕过上游硬门控。
 */

const TIMING_ACTIONS = Object.freeze({
  SILENT: "silent",
  WAIT: "wait",
  BOUNDARY: "boundary",
  IMMEDIATE: "immediate",
  DELAYED: "delayed",
  CANCEL: "cancel"
});

const PROTECTED_PHASES = new Set([
  "pre",
  "post",
  "verification",
  "transfer",
  "near_transfer",
  "far_transfer",
  "retention",
  "delayed",
  "delayed_retention"
]);

function isScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function silent(reason) {
  return { action: TIMING_ACTIONS.SILENT, reason, candidate_formed: false };
}

function candidate(action, reason) {
  return { action, reason, candidate_formed: true };
}

function restriction({ assessmentPhase, studentAuthority, cooldownState }) {
  if (PROTECTED_PHASES.has(String(assessmentPhase).toLowerCase())) {
    return silent("protected_assessment_phase");
  }
  if (studentAuthority?.is_kp_disabled === true || studentAuthority?.proactive_preference === "off") {
    return silent("student_disabled_kp_proactivity");
  }
  const activeUntil = cooldownState?.activeUntil;
  const now = Date.now();
  if (Number.isFinite(activeUntil) && activeUntil > now) {
    return { ...silent("cooling_down"), remaining_cooldown_ms: activeUntil - now };
  }
  return null;
}

function reflectionDecision({ interruptibility, threshold, atBoundary }) {
  if (atBoundary && isScore(interruptibility) && interruptibility >= threshold) {
    return candidate(TIMING_ACTIONS.BOUNDARY, "exploration_comparison_boundary");
  }
  return candidate(TIMING_ACTIONS.WAIT, "reflection_wait_for_boundary");
}

function practiceDecision({ need, interruptibility, atBoundary, helpNeedThreshold, interruptibilityThreshold }) {
  if (![need, interruptibility].every(isScore)) {
    return silent("required_evidence_missing");
  }
  if (need < helpNeedThreshold) {
    return silent("help_need_below_threshold");
  }
  if (interruptibility < interruptibilityThreshold) {
    return candidate(TIMING_ACTIONS.WAIT, "low_interruptibility_wait_for_boundary");
  }
  return atBoundary
    ? candidate(TIMING_ACTIONS.BOUNDARY, "natural_task_boundary_reached")
    : candidate(TIMING_ACTIONS.IMMEDIATE, "high_need_and_high_interruptibility");
}

class TimingGate {
  /**
   * @param {Object} [config]
   * @param {number} [config.helpNeedThreshold=0.70]
   * @param {number} [config.interruptibilityThreshold=0.60]
   * @param {number} [config.cooldownMs=300000] // 默认 5 分钟
   */
  constructor(config = {}) {
    this.helpNeedThreshold = config.helpNeedThreshold ?? 0.70;
    this.interruptibilityThreshold = config.interruptibilityThreshold ?? 0.60;
    this.cooldownMs = config.cooldownMs ?? 300000;
    if (!Number.isFinite(this.cooldownMs) || this.cooldownMs < 0) {
      throw new TypeError("TimingGate: invalid cooldown duration");
    }
    for (const value of [this.helpNeedThreshold, this.interruptibilityThreshold]) {
      if (!isScore(value)) throw new TypeError("TimingGate: invalid threshold");
    }
  }

  /**
   * 评估时机决策
   * @param {Object} params
   * @param {import('./evidence-package.cjs').EvidencePackage} params.evidence
   * @param {Object} [params.cooldownState] - 知识点冷却状态 { activeUntil: number }
   * @param {Object} [params.studentAuthority] - D5 学生授权状态 { is_kp_disabled: boolean }
   * @param {string} [params.assessmentPhase="practice"] - 当前所处阶段
   * @param {boolean} [params.atBoundary=false] - 当前是否处于天然断点 (如提交后、场景切换时)
   * @returns {{ action: string, reason: string, candidate_formed: boolean, remaining_cooldown_ms?: number }}
   */
  evaluate({ evidence, cooldownState, studentAuthority, assessmentPhase = "practice", atBoundary = false, verifiedReflectionOpportunity = false } = {}) {
    if (!evidence?.inference) {
      throw new TypeError("TimingGate: evidence package is required");
    }
    const blocked = restriction({ assessmentPhase, studentAuthority, cooldownState });
    if (blocked) return blocked;

    const { need_help_now: need, interruptible_now: interruptibility } = evidence.inference;
    if (verifiedReflectionOpportunity) {
      return reflectionDecision({ interruptibility, threshold: this.interruptibilityThreshold, atBoundary });
    }
    return practiceDecision({
      need, interruptibility, atBoundary,
      helpNeedThreshold: this.helpNeedThreshold,
      interruptibilityThreshold: this.interruptibilityThreshold
    });
  }
}

module.exports = { TimingGate, TIMING_ACTIONS, PROTECTED_PHASES: new Set(PROTECTED_PHASES) };
